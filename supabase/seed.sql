-- ============================================================
-- SEED DE DESARROLLO LOCAL
--
-- Lo corre `supabase db reset` (config.toml → [db.seed]) después de
-- aplicar las migraciones. NO se ejecuta contra la nube ni contra el
-- VPS: `db reset` solo apunta a la base local de Docker.
--
-- Qué deja montado:
--   · Una cuenta ("LoraMotors (local)") con UN usuario por cada rol,
--     para poder validar permisos entrando y saliendo sin tocar datos
--     reales. Todos con la misma contraseña.
--   · Inventario, contactos, embudo y ventas suficientes para que el
--     tablero, la vitrina y las listas no se vean vacíos.
--
-- Usuarios (contraseña: local1234)
--   owner@local.test   — Ana Owner     (owner)
--   admin@local.test   — Beto Admin    (admin)
--   agente@local.test  — Caro Agente   (agent)   ← el rol a validar
--   viewer@local.test  — Dani Viewer   (viewer)
--
-- Nada de esto sale de producción: los datos son inventados a mano.
-- Las fechas son relativas a NOW() para que el tablero siempre tenga
-- algo dentro del rango de 30/60/90 días, sin importar cuándo se corra.
-- ============================================================

-- ============================================================
-- 0. PERMISOS DE TABLA
--
-- Supabase alojado (y el VPS, instalado cuando esa era la conducta por
-- defecto) le otorga a anon/authenticated/service_role permisos sobre
-- las tablas nuevas del esquema public automáticamente. Las imágenes
-- recientes del stack local ya NO lo hacen: las tablas quedan con
-- TRUNCATE/REFERENCES/TRIGGER pero sin SELECT/INSERT/UPDATE/DELETE, y
-- entonces CUALQUIER consulta de la app se estrella contra un 42501
-- "permission denied" antes siquiera de llegar a la RLS.
--
-- Esto lo repone para que el entorno local se comporte como producción.
-- Va acá y no en una migración a propósito: `db reset` solo toca la
-- base local, mientras que una migración se aplicaría también al VPS,
-- que no lo necesita.
--
-- Es seguro: las 60+ tablas de public tienen RLS habilitada, así que el
-- permiso de tabla solo habilita a *intentar* la consulta — quién ve
-- qué lo siguen decidiendo las políticas. `anon` en particular termina
-- sin ver nada, porque toda política parte de `is_account_member()`.
-- ============================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public
  TO anon, authenticated, service_role;

-- ------------------------------------------------------------
-- Helper: alta de usuario en auth.
--
-- Dos trampas conocidas al sembrar usuarios a mano:
--
--   1. Hace falta la fila en auth.users Y su identidad en
--      auth.identities. Sin la segunda, el login responde "Invalid
--      login credentials" aunque el usuario exista.
--
--   2. Las columnas de token (confirmation_token, recovery_token, …)
--      tienen que ir en cadena vacía, NO en NULL. GoTrue las lee en un
--      string de Go y un NULL revienta el login entero con un 500
--      "Database error querying schema" — un error que no menciona por
--      ningún lado la columna culpable si no se miran sus logs.
--
-- Se crea temporal y se elimina al final: no tiene por qué sobrevivir
-- al seed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.seed_user(
  p_id        UUID,
  p_email     TEXT,
  p_full_name TEXT
) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new,
    email_change, email_change_token_current, phone_change,
    phone_change_token, reauthentication_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    p_id, 'authenticated', 'authenticated', p_email,
    crypt('local1234', gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', p_full_name),
    NOW(), NOW(),
    '', '', '', '', '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email),
    'email', p_id::text,
    NOW(), NOW(), NOW()
  );
END;
$$;

DO $$
DECLARE
  -- UUIDs fijos: el seed queda reproducible y se puede referenciar a
  -- un usuario concreto desde una consulta de depuración.
  v_owner   UUID := '00000000-0000-4000-a000-000000000001';
  v_admin   UUID := '00000000-0000-4000-a000-000000000002';
  v_agent   UUID := '00000000-0000-4000-a000-000000000003';
  v_viewer  UUID := '00000000-0000-4000-a000-000000000004';

  v_account UUID;

  v_pipeline UUID;
  v_stage_new UUID;
  v_stage_visit UUID;
  v_stage_won UUID;

  v_c_lucia UUID;
  v_c_jorge UUID;
  v_c_marta UUID;
  v_c_pedro UUID;

  v_v_logan UUID;
  v_v_onix UUID;
  v_v_duster UUID;
  v_v_spark UUID;
  v_v_tucson UUID;
  v_v_hilux UUID;
BEGIN
  -- ==========================================================
  -- 1. USUARIOS Y CUENTA
  --
  -- El trigger `on_auth_user_created` (migración 017) le arma a CADA
  -- alta su propia cuenta con rol owner. En vez de pelearse con él, se
  -- lo deja correr: después se reapunta a los otros tres a la cuenta
  -- del owner y se borran las cuentas sobrantes.
  --
  -- El orden importa: primero mover los perfiles, después borrar las
  -- cuentas. profiles.account_id es ON DELETE CASCADE, así que borrar
  -- una cuenta que todavía tiene su perfil apuntando se llevaría el
  -- perfil por delante.
  -- ==========================================================
  PERFORM pg_temp.seed_user(v_owner,  'owner@local.test',  'Ana Owner');
  PERFORM pg_temp.seed_user(v_admin,  'admin@local.test',  'Beto Admin');
  PERFORM pg_temp.seed_user(v_agent,  'agente@local.test', 'Caro Agente');
  PERFORM pg_temp.seed_user(v_viewer, 'viewer@local.test', 'Dani Viewer');

  SELECT account_id INTO v_account FROM profiles WHERE user_id = v_owner;

  UPDATE profiles SET account_id = v_account, account_role = 'admin'  WHERE user_id = v_admin;
  UPDATE profiles SET account_id = v_account, account_role = 'agent'  WHERE user_id = v_agent;
  UPDATE profiles SET account_id = v_account, account_role = 'viewer' WHERE user_id = v_viewer;

  DELETE FROM accounts WHERE owner_user_id IN (v_admin, v_agent, v_viewer);

  UPDATE accounts
     SET name             = 'LoraMotors (local)',
         default_currency = 'COP',
         showcase_enabled = TRUE,
         public_name      = 'LoraMotors',
         public_phone     = '+57 300 000 0000',
         public_address    = 'Cra 00 #00-00, Bogotá',
         public_whatsapp  = '573000000000'
   WHERE id = v_account;

  -- ==========================================================
  -- 2. ETIQUETAS
  --
  -- `user_id` sigue siendo NOT NULL en las tablas heredadas de la 001:
  -- ya no se usa para aislar (eso lo hace account_id + RLS), pero queda
  -- como columna de auditoría. Se le pone el owner a todo lo sembrado.
  -- ==========================================================
  INSERT INTO tags (account_id, user_id, name, color) VALUES
    (v_account, v_owner, 'Interesado',  '#22c55e'),
    (v_account, v_owner, 'Financiación','#3b82f6'),
    (v_account, v_owner, 'Frío',        '#94a3b8');

  -- ==========================================================
  -- 3. EMBUDO
  -- ==========================================================
  INSERT INTO pipelines (account_id, user_id, name)
  VALUES (v_account, v_owner, 'Ventas')
  RETURNING id INTO v_pipeline;

  INSERT INTO pipeline_stages (pipeline_id, name, position, color)
  VALUES (v_pipeline, 'Nuevo', 0, '#3b82f6') RETURNING id INTO v_stage_new;
  INSERT INTO pipeline_stages (pipeline_id, name, position, color)
  VALUES (v_pipeline, 'Visita agendada', 1, '#f59e0b') RETURNING id INTO v_stage_visit;
  INSERT INTO pipeline_stages (pipeline_id, name, position, color)
  VALUES (v_pipeline, 'Cerrado ganado', 2, '#22c55e') RETURNING id INTO v_stage_won;

  -- ==========================================================
  -- 4. CONTACTOS
  -- ==========================================================
  INSERT INTO contacts (account_id, user_id, phone, name, email) VALUES
    (v_account, v_owner, '573001112233', 'Lucía Ramírez', 'lucia@example.test')
    RETURNING id INTO v_c_lucia;
  INSERT INTO contacts (account_id, user_id, phone, name, email) VALUES
    (v_account, v_owner, '573002223344', 'Jorge Peña', 'jorge@example.test')
    RETURNING id INTO v_c_jorge;
  INSERT INTO contacts (account_id, user_id, phone, name, email) VALUES
    (v_account, v_owner, '573003334455', 'Marta Gil', 'marta@example.test')
    RETURNING id INTO v_c_marta;
  INSERT INTO contacts (account_id, user_id, phone, name, email) VALUES
    (v_account, v_owner, '573004445566', 'Pedro Salas', NULL)
    RETURNING id INTO v_c_pedro;

  -- ==========================================================
  -- 5. INVENTARIO
  --
  -- La mezcla está elegida para que el tablero tenga algo que mostrar
  -- en cada tarjeta: disponibles con antigüedad distinta (gráfico de
  -- aging), uno reservado, y dos vendidos DENTRO de los últimos 30 días
  -- para que "unidades vendidas", "ingresos" y "ticket promedio" no
  -- salgan en cero en el rango por defecto.
  -- ==========================================================
  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at)
  VALUES
    (v_account, 'Renault', 'Logan', 2019, 'ABC123', 42000000, 68000, 'available',
     'manual', 'gasoline', 'sedan', 'Blanco', 'used', 4, 'Bogotá', TRUE, NOW() - INTERVAL '12 days')
    RETURNING id INTO v_v_logan;

  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at)
  VALUES
    (v_account, 'Chevrolet', 'Onix', 2021, 'DEF456', 51000000, 31000, 'available',
     'automatic', 'gasoline', 'hatchback', 'Gris', 'used', 4, 'Medellín', TRUE, NOW() - INTERVAL '45 days')
    RETURNING id INTO v_v_onix;

  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at)
  VALUES
    (v_account, 'Renault', 'Duster', 2020, 'GHI789', 63000000, 52000, 'available',
     'manual', 'diesel', 'suv', 'Rojo', 'used', 5, 'Bogotá', TRUE, NOW() - INTERVAL '120 days')
    RETURNING id INTO v_v_duster;

  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at)
  VALUES
    (v_account, 'Chevrolet', 'Spark GT', 2018, 'JKL012', 29500000, 94000, 'reserved',
     'manual', 'gasoline', 'hatchback', 'Azul', 'used', 5, 'Cali', TRUE, NOW() - INTERVAL '30 days')
    RETURNING id INTO v_v_spark;

  -- Vendidos: `status = 'sold'` es obligatorio para poder llenar
  -- sold_price / sold_at (constraint inventory_vehicles_sold_coherence
  -- de la migración 508).
  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at, sold_price, sold_at, sold_to_contact_id)
  VALUES
    (v_account, 'Hyundai', 'Tucson', 2019, 'MNO345', 78000000, 71000, 'sold',
     'automatic', 'diesel', 'suv', 'Negro', 'used', 5, 'Bogotá', FALSE,
     NOW() - INTERVAL '90 days', 76500000, NOW() - INTERVAL '8 days', v_c_lucia)
    RETURNING id INTO v_v_tucson;

  INSERT INTO inventory_vehicles
    (account_id, brand, model, year, license_plate, price, mileage, status,
     transmission, fuel_type, body_type, color, condition, doors, plate_city,
     on_display, created_at, sold_price, sold_at, sold_to_contact_id)
  VALUES
    (v_account, 'Toyota', 'Hilux', 2017, 'PQR678', 112000000, 130000, 'sold',
     'manual', 'diesel', 'pickup', 'Plata', 'used', 4, 'Medellín', FALSE,
     NOW() - INTERVAL '150 days', 108000000, NOW() - INTERVAL '22 days', v_c_jorge)
    RETURNING id INTO v_v_hilux;

  -- ==========================================================
  -- 6. COSTOS DE ADQUISICIÓN
  --
  -- Tabla admin-only en RLS (migración 508). Es justamente la que
  -- permite comprobar que el panel de márgenes existe para admin y
  -- devuelve cero filas para el agente: si no hubiera datos acá, un
  -- panel vacío no probaría nada.
  -- ==========================================================
  INSERT INTO vehicle_acquisitions (account_id, vehicle_id, purchase_cost, purchase_date) VALUES
    (v_account, v_v_logan,  36000000, (NOW() - INTERVAL '20 days')::date),
    (v_account, v_v_onix,   44000000, (NOW() - INTERVAL '55 days')::date),
    (v_account, v_v_duster, 55000000, (NOW() - INTERVAL '130 days')::date),
    (v_account, v_v_spark,  25000000, (NOW() - INTERVAL '38 days')::date),
    (v_account, v_v_tucson, 68000000, (NOW() - INTERVAL '100 days')::date),
    (v_account, v_v_hilux,  95000000, (NOW() - INTERVAL '160 days')::date);

  -- ==========================================================
  -- 7. NEGOCIOS Y CONSULTAS
  -- ==========================================================
  INSERT INTO deals (account_id, user_id, pipeline_id, stage_id, contact_id, title, value, currency) VALUES
    (v_account, v_owner, v_pipeline, v_stage_new,   v_c_marta, 'Marta — Onix 2021',   51000000, 'COP'),
    (v_account, v_owner, v_pipeline, v_stage_visit, v_c_pedro, 'Pedro — Duster 2020', 63000000, 'COP'),
    (v_account, v_owner, v_pipeline, v_stage_won,   v_c_lucia, 'Lucía — Tucson 2019', 76500000, 'COP');

  INSERT INTO vehicle_inquiries (account_id, vehicle_id, contact_id) VALUES
    (v_account, v_v_onix,   v_c_marta),
    (v_account, v_v_onix,   v_c_pedro),
    (v_account, v_v_duster, v_c_pedro),
    (v_account, v_v_logan,  v_c_marta);
END $$;

DROP FUNCTION IF EXISTS pg_temp.seed_user(UUID, TEXT, TEXT);
