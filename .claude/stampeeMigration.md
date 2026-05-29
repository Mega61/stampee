# Handoff: fork de Stampee desacoplado de Supabase

## Contexto del proyecto

Estamos montando dos plataformas open source autohospedadas en una sola VM de GCP, para el negocio:

- **Strapi** (headless CMS) — ya decidido, con su propio uso de PostgreSQL.
- **Stampee** (sistema de fidelización de tarjetas de sellos) — repo: https://github.com/danlim26/stampee

El objetivo con Stampee es **forkearlo y desacoplarlo de Supabase**, para que use el **mismo PostgreSQL** que ya correrá en la VM (sin Supabase Cloud, sin Supabase self-hosted). Control total de la infra, todo en una VM chica.

El caso de uso es **simple a propósito**: tarjetas de sellos digitales para un solo negocio ("compra 10, llevá 1 gratis"). No se necesitan puntos, tiers, ni campañas de email. No sobre-construir.

## Tu primera tarea: explorar antes de asumir

NO confíes en este documento como descripción exacta del código. El repo no ha sido leído línea por línea. Tu primer paso es **clonar y entender la estructura real** antes de cambiar nada:

```bash
git clone https://github.com/danlim26/stampee.git
cd stampee
```

Luego inspecciona y reporta lo que realmente encuentres:

1. Lee `README.md`, `package.json`, `.env.example` y `vercel.json`.
2. Revisa la carpeta `supabase/` — especialmente `supabase/migration.sql` (es el esquema canónico de instalación limpia, según el README), `supabase/seed.sql`, y `supabase/legacy-patches/`.
3. Mapea **todos los puntos donde el frontend toca Supabase**: busca en el código `createClient`, `supabase.auth`, `supabase.from`, `supabase.rpc`, `supabase.storage`, y la lectura de `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`.
4. Identifica qué funciones RPC (PL/pgSQL) usa, y qué hace cada una.
5. Revisa cómo maneja autenticación de dueño y de staff, y qué rutas son públicas para clientes.

Cuando termines, **resúmeme la arquitectura real** (qué stack, qué tablas, qué RPCs, qué endpoints de Supabase consume) y **señala cualquier diferencia** con lo que este handoff asume. Si algo difiere de forma importante, paramos y ajustamos el plan antes de seguir.

## Stack confirmado del repo (a verificar)

Según su README, Stampee es: React 18 + TypeScript + Vite + Tailwind + Radix UI + React Router en el frontend; y usa Supabase para Auth (GoTrue), Postgres, Storage y funciones RPC. Licencia MIT. Sin suite de tests; `npm run build` es la verificación principal. Verifica que esto siga siendo así en el código que clones.

## El trabajo de desacople

El problema central: Stampee es un SPA que habla **directo a Supabase desde el browser**, protegido por RLS policies. Al quitar Supabase, **no se puede exponer Postgres al browser**. Hay que introducir una **capa de API propia** entre el frontend y Postgres.

Las cuatro dependencias de Supabase y su reemplazo:

1. **Postgres** — el fácil. Supabase ES Postgres. El esquema de `supabase/migration.sql` corre casi tal cual en el Postgres compartido. Crearlo bajo un **esquema dedicado** (p. ej. `loyalty`) para no chocar con las tablas de Strapi.
2. **Auth (GoTrue)** — el trabajo principal. Reemplazar el login de dueño/staff. Implementar JWT propio (o una librería como `jose` para firmar/verificar). Las contraseñas con hashing fuerte (`argon2` o `bcrypt`).
3. **Storage** — imágenes de tarjetas/logos. Reemplazar con un bucket de Google Cloud Storage, o con disco local montado como volumen Docker. Decide según lo que el código realmente sube y dónde se referencian las URLs.
4. **Funciones RPC** — son PL/pgSQL que viven en la base. Migran con el esquema, pero las llamadas `supabase.rpc(...)` del frontend hay que reapuntarlas a endpoints de la nueva API.

### La nueva API de lealtad

Construir una API delgada (Node + Fastify o Express; TypeScript para mantener consistencia con el frontend). Para este caso simple, el set de endpoints es acotado — algo como:

- `POST /auth/login` — login de dueño/staff, devuelve JWT
- `GET /cards` — listar tarjetas de sellos del negocio
- `POST /cards/:id/stamp` — agregar un sello (acción de staff)
- `POST /cards/:id/redeem` — canjear recompensa al completar
- `GET /staff` / `POST /staff` — gestión de cuentas de staff (solo dueño)
- rutas públicas de cliente para ver tarjetas emitidas (verificar en el código cuáles existen)

Ajusta este listado a lo que el código real necesite — no agregues endpoints que el frontend no use.

Reglas:
- Middleware de auth que valide el JWT en rutas protegidas; distinguir rol dueño vs staff.
- La lógica de "completar tarjeta = recompensa" debe vivir en la API o en Postgres (transacción atómica para el sello), no en el cliente.
- Toda la validación de permisos que antes hacían las RLS policies ahora vive en la API. Esto es crítico de seguridad: lo que protegían las RLS NO debe quedar expuesto.

## Integración con la infraestructura

El despliegue final es Docker Compose en la VM con estos servicios: Caddy (reverse proxy + HTTPS automático con Let's Encrypt), Strapi, PostgreSQL (compartido), la nueva API de lealtad, y el frontend de Stampee servido como estático.

- El frontend de Stampee compila a estáticos (`npm run build` → Vite) y Caddy los sirve directo.
- Caddy enruta por subdominio: p. ej. `cms.dominio` → Strapi, `lealtad.dominio` → frontend de Stampee, y un path o subdominio para la API (`/api` o `api.dominio`).
- El Postgres es uno solo, con esquemas separados (`public`/strapi y `loyalty`).
- Variables de entorno: reemplazar `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` por la URL de la nueva API (`VITE_API_URL`). Limpiar del código toda referencia a Supabase una vez migrado.

Entregables esperados de la parte de infra (puedes generarlos cuando el desacople esté funcional): `docker-compose.yml`, `Caddyfile`, `Dockerfile` para la API de lealtad, y un `.env.example` actualizado sin nada de Supabase.

## Orden de trabajo sugerido

1. Clonar, explorar, y reportar la arquitectura real + diferencias con este handoff. **Esperar confirmación antes de seguir.**
2. Migrar el esquema a Postgres bajo el esquema `loyalty`; verificar que las RPCs migren.
3. Construir la API de lealtad (auth primero, luego endpoints de sellos).
4. Reapuntar el frontend: auth, llamadas a datos, storage. Quitar el cliente de Supabase.
5. Probar el flujo completo localmente (`npm run build` + correr la API + Postgres local en Docker).
6. Generar los archivos de infra (compose, Caddyfile, Dockerfiles).

## Restricciones y principios

- **MIT, mantener la atribución de licencia** del proyecto original en el fork.
- **No sobre-construir.** Es un sistema de sellos simple. Nada de tiers, puntos, ni features que el caso no pide.
- **Seguridad primero en el auth y los permisos** — es lo que antes protegían las RLS policies; no dejar huecos.
- **No exponer Postgres al browser** bajo ninguna circunstancia.
- Si algo del código real contradice este plan, **detente y repórtalo** en vez de improvisar sobre una suposición.
- No hay tests en el repo; al terminar cada parte, deja al menos una verificación manual reproducible documentada.