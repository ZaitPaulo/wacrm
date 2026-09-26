"""Genera una cuenta de cobro en PDF para el cliente del CRM (Lora Motors).

Lee los datos fijos de ../datos.local.json y lleva el consecutivo en
../registro.local.json. Ambos archivos están fuera de git porque contienen la
cédula y la cuenta bancaria del emisor.

Uso:
  python generar.py --mensualidad 2026-10
  python generar.py --saldo-inicial --mensualidad 2026-09
  python generar.py --mensualidad 2026-10 --mensualidad 2026-11 --extra "Bolsa de 10 horas de desarrollo=1200000"
  python generar.py --mensualidad 2026-10 --dry-run      # muestra qué cobraría, sin generar nada

Opciones:
  --numero N       fuerza el consecutivo (por defecto, el siguiente del registro)
  --fecha AAAA-MM-DD  fecha de emisión (por defecto, hoy)
  --plazo-dias N   agrega "Fecha límite de pago" a N días de la emisión
  --preview        además del PDF, deja un PNG de la primera página junto al registro
"""
import argparse
import calendar
import datetime as dt
import json
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
DATOS = BASE / "datos.local.json"
REGISTRO = BASE / "registro.local.json"

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


# ---------------------------------------------------------------- números a letras
_UNI = ["", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
        "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE",
        "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS",
        "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"]
_DEC = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"]
_CEN = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS",
        "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"]


def _hasta_999(n, apocopar):
    """0..999 en letras. `apocopar` cambia UNO→UN y VEINTIUNO→VEINTIÚN (antes de MIL/MILLONES/PESOS)."""
    if n == 0:
        return ""
    if n == 100:
        return "CIEN"
    c, r = divmod(n, 100)
    partes = [_CEN[c]] if c else []
    if r:
        if r < 30:
            t = _UNI[r]
        else:
            d, u = divmod(r, 10)
            t = _DEC[d] + (" Y " + _UNI[u] if u else "")
        if apocopar:
            t = t.replace("VEINTIUNO", "VEINTIÚN")
            if t == "UNO" or t.endswith(" UNO"):
                t = t[:-3] + "UN"
        partes.append(t)
    return " ".join(partes)


def en_letras(valor):
    """Entero en pesos → 'CUATRO MILLONES DE PESOS M/CTE'."""
    if valor == 0:
        return "CERO PESOS M/CTE"
    millones, resto = divmod(valor, 1_000_000)
    miles, unidades = divmod(resto, 1000)
    partes = []
    if millones:
        partes.append("UN MILLÓN" if millones == 1 else _texto_miles(millones, True) + " MILLONES")
    if miles:
        partes.append("MIL" if miles == 1 else _hasta_999(miles, True) + " MIL")
    if unidades:
        partes.append(_hasta_999(unidades, True))
    texto = " ".join(partes)
    # "UN MILLÓN DE PESOS" / "DOS MILLONES DE PESOS", pero "UN MILLÓN QUINIENTOS MIL PESOS"
    de = " DE" if millones and not resto else ""
    return f"{texto}{de} PESOS M/CTE"


def _texto_miles(n, apocopar):
    """Hasta 999.999, para el multiplicador de los millones."""
    m, u = divmod(n, 1000)
    partes = []
    if m:
        partes.append("MIL" if m == 1 else _hasta_999(m, True) + " MIL")
    if u:
        partes.append(_hasta_999(u, apocopar))
    return " ".join(partes)


def pesos(v):
    return "$ " + f"{v:,.0f}".replace(",", ".")


def fecha_larga(f):
    return f"{f.day} de {MESES[f.month - 1]} de {f.year}"


# ---------------------------------------------------------------- conceptos
def concepto_mensualidad(mes_str, valor):
    anio, mes = map(int, mes_str.split("-"))
    ultimo = calendar.monthrange(anio, mes)[1]
    return {
        "tipo": "mensualidad", "periodo": mes_str, "valor": valor,
        "titulo": "Mantenimiento y licenciamiento mensual.",
        "detalle": f"Periodo: 1 al {ultimo} de {MESES[mes - 1]} de {anio}.",
    }


def concepto_saldo_inicial(contrato):
    total = contrato["inversion_inicial"]
    anticipo = contrato["anticipo_pagado"]
    return {
        "tipo": "saldo_inicial", "valor": total - anticipo,
        "titulo": "Saldo del 50% de la inversión inicial (implementación y puesta en marcha).",
        "detalle": f"Valor total {pesos(total)}; anticipo del 50% ({pesos(anticipo)}) "
                   f"recibido en {contrato['mes_anticipo']}.",
    }


def concepto_extra(texto):
    desc, _, valor = texto.rpartition("=")
    if not desc:
        sys.exit(f"--extra debe ser 'Descripción=valor', recibí: {texto!r}")
    return {"tipo": "extra", "valor": int(valor.replace(".", "").replace(",", "")),
            "titulo": desc.strip(), "detalle": ""}


# ---------------------------------------------------------------- PDF
def construir_pdf(ruta, numero, fecha, conceptos, datos, fecha_limite):
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_RIGHT
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import cm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    em, cl, bk, ct = datos["emisor"], datos["cliente"], datos["banco"], datos["contrato"]
    total = sum(c["valor"] for c in conceptos)

    doc = SimpleDocTemplate(str(ruta), pagesize=letter, leftMargin=2.5 * cm, rightMargin=2.5 * cm,
                            topMargin=1.8 * cm, bottomMargin=1.5 * cm,
                            title=f"Cuenta de cobro No. {numero:03d} - {cl['razon_social']}",
                            author=em["nombre"])
    B = ParagraphStyle("b", fontName="Helvetica", fontSize=10.5, leading=15, alignment=TA_JUSTIFY)
    Bc = ParagraphStyle("bc", parent=B, alignment=TA_CENTER)
    Br = ParagraphStyle("br", parent=B, alignment=TA_RIGHT)
    T = ParagraphStyle("t", fontName="Helvetica-Bold", fontSize=16, leading=20, alignment=TA_CENTER)
    S = ParagraphStyle("s", fontName="Helvetica", fontSize=9, leading=12, alignment=TA_JUSTIFY,
                       textColor=colors.HexColor("#333333"))
    H = ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=10, leading=13, textColor=colors.white)
    C = ParagraphStyle("c", fontName="Helvetica", fontSize=10, leading=13)
    CR = ParagraphStyle("cr", parent=C, alignment=TA_RIGHT)
    AZUL = colors.HexColor("#1F497D")

    cc = f"C.C. {em['cedula']} de {em['ciudad_cedula']}"
    st = [
        Paragraph(f"CUENTA DE COBRO No. {numero:03d}", T), Spacer(1, 16),
        Paragraph(f"{em['ciudad']}, {fecha_larga(fecha)}", Br), Spacer(1, 12),
        Paragraph(f"<b>{cl['razon_social']}</b><br/>NIT {cl['nit']}<br/>{cl['direccion']}<br/>{cl['ciudad']}", B),
        Spacer(1, 14),
        Paragraph("<b>DEBE A:</b>", Bc), Spacer(1, 4),
        Paragraph(f"<b>{em['nombre'].upper()}</b><br/>{cc}", Bc), Spacer(1, 16),
        Paragraph("<b>LA SUMA DE:</b>", Bc), Spacer(1, 4),
        Paragraph(f"<b>{en_letras(total)} ({pesos(total)})</b>", Bc), Spacer(1, 14),
        Paragraph(f"Por concepto de los servicios del <b>{ct['servicio']}</b>, según la propuesta del "
                  f"{ct['fecha_propuesta']} y los valores ajustados de común acuerdo (inversión inicial de "
                  f"{pesos(ct['inversion_inicial'])} y mensualidad de {pesos(ct['mensualidad'])}), así:", B),
        Spacer(1, 12),
    ]

    filas = [[Paragraph("Concepto", H), Paragraph("Valor", ParagraphStyle("hr", parent=H, alignment=TA_RIGHT))]]
    for c in conceptos:
        det = f"<br/><font size=9 color='#555555'>{c['detalle']}</font>" if c["detalle"] else ""
        filas.append([Paragraph(c["titulo"] + det, C), Paragraph(pesos(c["valor"]), CR)])
    filas.append([Paragraph("<b>TOTAL A PAGAR</b>", C), Paragraph(f"<b>{pesos(total)}</b>", CR)])
    t = Table(filas, colWidths=[12.3 * cm, 4.2 * cm])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), AZUL),
        ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#E8EEF6")),
        ("GRID", (0, 0), (-1, -1), 0.6, colors.HexColor("#8A9BB3")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 8), ("RIGHTPADDING", (0, 0), (-1, -1), 8),
    ]))
    st += [t, Spacer(1, 12)]

    pago = (f"<b>Forma de pago:</b> consignación o transferencia a la cuenta de {bk['tipo']} "
            f"<b>{bk['banco']} No. {bk['numero']}</b>, a nombre de {bk['titular']}, C.C. {em['cedula']}.")
    if fecha_limite:
        pago += f" <b>Fecha límite de pago:</b> {fecha_larga(fecha_limite)}."
    st += [Paragraph(pago, B), Spacer(1, 12)]

    if datos.get("declaracion"):
        st += [Paragraph(datos["declaracion"], S)]
    st.append(Spacer(1, 38))
    firma = Table([[""]], colWidths=[7 * cm], rowHeights=[1])
    firma.setStyle(TableStyle([("LINEABOVE", (0, 0), (-1, -1), 0.8, colors.black)]))
    firma.hAlign = "LEFT"
    st += [firma, Spacer(1, 4),
           Paragraph(f"<b>{em['nombre'].upper()}</b><br/>{cc}<br/>Tel. {em['telefono']}", B)]
    doc.build(st)


# ---------------------------------------------------------------- main
def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--mensualidad", action="append", default=[], metavar="AAAA-MM")
    ap.add_argument("--saldo-inicial", action="store_true")
    ap.add_argument("--extra", action="append", default=[], metavar="DESC=VALOR")
    ap.add_argument("--numero", type=int)
    ap.add_argument("--fecha")
    ap.add_argument("--plazo-dias", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--preview", action="store_true")
    a = ap.parse_args()

    if not DATOS.exists():
        sys.exit(f"Falta {DATOS}. Cópialo desde datos.ejemplo.json y llénalo.")
    datos = json.loads(DATOS.read_text(encoding="utf-8"))
    registro = json.loads(REGISTRO.read_text(encoding="utf-8")) if REGISTRO.exists() else {"cuentas": []}
    ct = datos["contrato"]

    conceptos = []
    if a.saldo_inicial:
        conceptos.append(concepto_saldo_inicial(ct))
    for m in sorted(a.mensualidad):
        conceptos.append(concepto_mensualidad(m, ct["mensualidad"]))
    conceptos += [concepto_extra(e) for e in a.extra]
    if not conceptos:
        sys.exit("No hay nada que cobrar: usa --mensualidad, --saldo-inicial o --extra.")

    # Evita cobrar dos veces el mismo concepto.
    ya = {(c["tipo"], c.get("periodo")) for cu in registro["cuentas"] for c in cu["conceptos"]
          if c["tipo"] != "extra"}
    repetidos = [c for c in conceptos if (c["tipo"], c.get("periodo")) in ya]
    if repetidos:
        sys.exit("Estos conceptos ya se cobraron en una cuenta anterior: "
                 + ", ".join(c.get("periodo") or c["tipo"] for c in repetidos))

    numero = a.numero or max((c["numero"] for c in registro["cuentas"]), default=0) + 1
    if any(c["numero"] == numero for c in registro["cuentas"]):
        sys.exit(f"La cuenta No. {numero:03d} ya existe en el registro.")
    fecha = dt.date.fromisoformat(a.fecha) if a.fecha else dt.date.today()
    limite = fecha + dt.timedelta(days=a.plazo_dias) if a.plazo_dias else None
    total = sum(c["valor"] for c in conceptos)

    print(f"Cuenta de cobro No. {numero:03d} — {fecha.isoformat()}")
    for c in conceptos:
        print(f"  {pesos(c['valor']):>14}  {c['titulo']} {c['detalle']}")
    print(f"  {pesos(total):>14}  TOTAL — {en_letras(total)}")
    if a.dry_run:
        return

    salida = Path(datos["carpeta_salida"])
    salida.mkdir(parents=True, exist_ok=True)
    ruta = salida / f"Cuenta-de-cobro-{numero:03d}-{datos['cliente']['archivo']}.pdf"
    construir_pdf(ruta, numero, fecha, conceptos, datos, limite)

    registro["cuentas"].append({
        "numero": numero, "fecha": fecha.isoformat(), "total": total, "pagada": False,
        "archivo": str(ruta),
        "conceptos": [{k: c[k] for k in ("tipo", "periodo", "valor", "titulo") if k in c} for c in conceptos],
    })
    REGISTRO.write_text(json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"PDF: {ruta}")

    if a.preview:
        import pypdfium2
        pdf = pypdfium2.PdfDocument(str(ruta))
        png = BASE / "preview.local.png"
        pdf[0].render(scale=1.3).to_pil().save(png)
        print(f"Páginas: {len(pdf)} · Vista previa: {png}")


if __name__ == "__main__":
    main()
