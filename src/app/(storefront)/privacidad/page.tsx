import type { Metadata } from 'next'
import Link from 'next/link'
import { getShowcase } from '@/lib/showcase/data'
import { getBaseUrl } from '@/lib/showcase/site-url'
import { StoreNav } from '@/components/storefront/store-nav'
import { StoreFooter } from '@/components/storefront/footer'
import { APP_NAME } from '@/lib/brand'

// Política de privacidad pública. Existe por dos motivos a la vez: la Ley
// 1581 de 2012 obliga a publicarla, y Meta exige una URL de política
// accesible para sacar la app del modo desarrollo — sin ella el número de
// producción no puede escribirle a usuarios reales.
//
// Dinámica como el resto de la vitrina: el responsable del tratamiento y
// sus datos de contacto salen de Ajustes → Public showcase, así que
// cambiar el correo del negocio en el CRM actualiza también el aviso
// legal. Si la vitrina está apagada la página SIGUE respondiendo, con el
// nombre del producto como respaldo — que Meta reintente esta URL dentro
// de un mes y encuentre un 404 costaría la app entera.
export const dynamic = 'force-dynamic'

/**
 * Fecha de la última revisión del texto. A mano y no `new Date()`: al
 * titular le importa cuándo cambiaron las condiciones, no cuándo se
 * recompiló el sitio. Actualízala cuando cambie el contenido legal.
 */
const LAST_UPDATED = '24 de agosto de 2026'

export async function generateMetadata(): Promise<Metadata> {
  const [data, base] = await Promise.all([getShowcase(), getBaseUrl()])
  const name = data?.account.public_name?.trim() || data?.account.name || APP_NAME
  const title = `Política de privacidad — ${name}`
  const description = `Cómo ${name} recolecta, usa y protege los datos personales de quienes nos escriben por WhatsApp o visitan nuestra vitrina.`

  return {
    metadataBase: new URL(base),
    title: { absolute: title },
    description,
    // El layout raíz pone noindex para la app privada; este aviso legal sí
    // debe ser rastreable: Meta y los buscadores tienen que poder leerlo.
    robots: { index: true, follow: true },
    alternates: { canonical: '/privacidad' },
    openGraph: { title, description, url: `${base}/privacidad`, type: 'website' },
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="text-lg font-bold tracking-tight text-black">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-[#44474d]">
        {children}
      </div>
    </section>
  )
}

export default async function PrivacyPage() {
  const data = await getShowcase()
  const account = data?.account ?? null
  const displayName = account?.public_name?.trim() || account?.name || APP_NAME
  const waDigits = account?.public_whatsapp?.replace(/\D/g, '') || null

  const body = (
    <article className="mx-auto max-w-[760px] px-6 py-12 lg:px-12">
      <h1 className="text-3xl font-black uppercase tracking-tight text-black">
        Política de tratamiento de datos personales
      </h1>
      <p className="mt-2 text-sm text-[#75777e]">Última actualización: {LAST_UPDATED}</p>

      <p className="mt-6 text-sm leading-relaxed text-[#44474d]">
        En {displayName} tratamos los datos personales de quienes nos contactan
        con el cuidado que exige la Ley Estatutaria 1581 de 2012 y el Decreto
        1074 de 2015 de Colombia. Este documento explica qué información
        recogemos, para qué la usamos, con quién la compartimos y cómo puedes
        controlarla.
      </p>

      <Section title="1. Responsable del tratamiento">
        <p>
          {displayName} es el responsable del tratamiento de los datos personales
          descritos en esta política.
        </p>
        <ul className="space-y-1">
          {account?.public_address && <li>Dirección: {account.public_address}</li>}
          {account?.public_email && (
            <li>
              Correo:{' '}
              <a
                href={`mailto:${account.public_email}`}
                className="font-medium text-[#0059bb] underline"
              >
                {account.public_email}
              </a>
            </li>
          )}
          {account?.public_phone && <li>Teléfono: {account.public_phone}</li>}
          {waDigits && (
            <li>
              WhatsApp:{' '}
              <a
                href={`https://wa.me/${waDigits}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-[#0059bb] underline"
              >
                escríbenos
              </a>
            </li>
          )}
        </ul>
      </Section>

      <Section title="2. Qué datos recogemos">
        <p>Recogemos únicamente lo que necesitamos para atenderte:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong className="text-[#191c1e]">Cuando nos escribes por WhatsApp:</strong>{' '}
            tu número de teléfono, el nombre que muestra tu perfil, el contenido
            de los mensajes que nos envías y los archivos que adjuntes (fotos,
            documentos, audios).
          </li>
          <li>
            <strong className="text-[#191c1e]">Durante una negociación:</strong> los
            datos que nos entregues voluntariamente para cotizar, separar o
            formalizar la compra o venta de un vehículo, como tu nombre completo,
            documento de identidad y los datos del vehículo.
          </li>
          <li>
            <strong className="text-[#191c1e]">Al navegar la vitrina:</strong> datos
            técnicos que envía tu navegador (dirección IP, tipo de dispositivo,
            páginas visitadas), usados solo para que el sitio funcione y esté
            seguro.
          </li>
        </ul>
        <p>
          No pedimos ni almacenamos datos sensibles, y nunca solicitamos claves,
          números completos de tarjetas ni credenciales bancarias por WhatsApp.
          Si alguien lo hace en nuestro nombre, no somos nosotros.
        </p>
      </Section>

      <Section title="3. Para qué los usamos">
        <ul className="list-disc space-y-1 pl-5">
          <li>Responder tus consultas y darte información sobre vehículos.</li>
          <li>Gestionar el proceso de compra, venta o separación de un vehículo.</li>
          <li>Hacer seguimiento comercial a las conversaciones que iniciaste.</li>
          <li>
            Enviarte información sobre vehículos o promociones, solo si lo
            autorizaste. Puedes pedirnos que dejemos de hacerlo en cualquier
            momento.
          </li>
          <li>Cumplir obligaciones legales, contables y tributarias.</li>
        </ul>
        <p>
          Usamos herramientas automatizadas, incluida inteligencia artificial,
          para clasificar conversaciones y redactar respuestas más rápidas. Una
          persona de nuestro equipo puede revisar y continuar cualquier
          conversación, y siempre puedes pedir que te atienda alguien del equipo.
        </p>
      </Section>

      <Section title="4. WhatsApp y Meta">
        <p>
          Nuestra atención por WhatsApp funciona sobre la Plataforma de WhatsApp
          Business de Meta Platforms, Inc. Los mensajes que intercambias con
          nosotros pasan por la infraestructura de Meta y quedan sujetos también
          a sus propias políticas, que puedes consultar en{' '}
          <a
            href="https://www.whatsapp.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[#0059bb] underline"
          >
            whatsapp.com/legal/privacy-policy
          </a>
          . Nosotros guardamos una copia de esas conversaciones en nuestro
          sistema de gestión comercial para poder darles continuidad.
        </p>
      </Section>

      <Section title="5. Con quién los compartimos">
        <p>
          No vendemos ni alquilamos datos personales. Los compartimos solo con
          quien hace falta para prestarte el servicio:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Meta Platforms, Inc., como operador de la mensajería de WhatsApp.</li>
          <li>
            Nuestro proveedor de servidores, donde se aloja el sistema de gestión
            comercial.
          </li>
          <li>
            Proveedores de modelos de inteligencia artificial que procesan el
            texto de una conversación para sugerir la respuesta.
          </li>
          <li>
            Autoridades competentes, cuando una norma o una orden judicial nos
            obligue a entregarlos.
          </li>
        </ul>
      </Section>

      <Section title="6. Cuánto tiempo los conservamos">
        <p>
          Conservamos tus datos mientras dure la relación comercial y, después,
          durante el tiempo que exijan las obligaciones legales, contables y
          tributarias que nos apliquen. Cumplido ese plazo, o cuando nos pidas la
          supresión y no exista un deber legal de conservarlos, los eliminamos.
        </p>
      </Section>

      <Section title="7. Tus derechos como titular">
        <p>La ley colombiana te reconoce el derecho a:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Conocer qué datos tuyos tenemos y cómo los estamos usando.</li>
          <li>Actualizarlos o rectificarlos cuando estén incompletos o errados.</li>
          <li>
            Solicitar su supresión, salvo que exista un deber legal o contractual
            de conservarlos.
          </li>
          <li>Revocar la autorización que nos diste para tratarlos.</li>
          <li>
            Solicitar prueba de la autorización otorgada, salvo en los casos en
            que la ley no la exige.
          </li>
          <li>
            Presentar quejas ante la Superintendencia de Industria y Comercio por
            infracciones a la Ley 1581 de 2012.
          </li>
        </ul>
      </Section>

      <Section title="8. Cómo ejercerlos">
        <p>
          Escríbenos
          {account?.public_email ? (
            <>
              {' '}
              a{' '}
              <a
                href={`mailto:${account.public_email}`}
                className="font-medium text-[#0059bb] underline"
              >
                {account.public_email}
              </a>
            </>
          ) : (
            ' por los canales de contacto de esta página'
          )}
          {waDigits ? ' o por nuestro WhatsApp' : ''}, indicando tu nombre, tu
          solicitud y un medio para responderte. Atendemos las consultas dentro
          de los diez (10) días hábiles siguientes y los reclamos dentro de los
          quince (15) días hábiles, en los términos que fija la ley. Si
          necesitamos más tiempo, te lo informamos con los motivos antes de que
          venza el plazo.
        </p>
      </Section>

      <Section title="9. Seguridad">
        <p>
          Aplicamos medidas técnicas y administrativas razonables para proteger
          tus datos: el acceso al sistema de gestión está restringido al personal
          autorizado, las conexiones viajan cifradas y las credenciales de los
          servicios conectados se almacenan cifradas. Ningún sistema es
          infalible, pero nos comprometemos a informarte si un incidente llegara
          a afectar tus datos.
        </p>
      </Section>

      <Section title="10. Cookies">
        <p>
          La vitrina pública no usa cookies de publicidad ni de seguimiento de
          terceros. El acceso privado al sistema de gestión usa cookies
          estrictamente necesarias para mantener la sesión de quienes trabajan
          con nosotros.
        </p>
      </Section>

      <Section title="11. Menores de edad">
        <p>
          Nuestros servicios están dirigidos a mayores de edad. No recogemos
          datos de menores de forma consciente; si detectamos que lo hicimos sin
          autorización de su representante legal, los eliminamos.
        </p>
      </Section>

      <Section title="12. Cambios en esta política">
        <p>
          Podemos actualizar este documento cuando cambien nuestras prácticas o
          la normativa aplicable. La versión vigente es siempre la publicada en
          esta página, con su fecha de última actualización arriba.
        </p>
      </Section>

      <div className="mt-12 border-t border-[#c5c6cd] pt-6">
        <Link href="/" className="text-sm font-medium text-[#0059bb] underline">
          Volver a la vitrina
        </Link>
      </div>
    </article>
  )

  // Vitrina apagada: sin datos de cuenta no hay nav ni pie que renderizar,
  // pero el aviso legal tiene que seguir en pie.
  if (!account) {
    return <div className="min-h-screen bg-[#f7f9fb] text-[#191c1e]">{body}</div>
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f9fb] text-[#191c1e]">
      <StoreNav account={account} />
      <main className="flex-grow">{body}</main>
      <StoreFooter account={account} />
    </div>
  )
}
