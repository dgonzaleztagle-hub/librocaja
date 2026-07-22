# Caja Clara

Aplicación privada e independiente para preparar, conciliar, cerrar y exportar Libros de Caja de contribuyentes Pro Pyme en Chile. Puede compartir un proyecto Supabase y el scraper Railway con PlusContable, pero no lee ni modifica sus tablas, empresas ni credenciales.

## Puesta en marcha

1. Crear el esquema aislado `libro_caja` en el proyecto Supabase elegido y ejecutar `supabase/migrations/001_initial.sql`.
2. En Vercel, configurar `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ALLOWED_USER_EMAIL`, `SII_CREDENTIALS_KEY`, `RAILWAY_SCRAPER_URL` y `RAILWAY_INTERNAL_API_KEY`.
3. Generar `SII_CREDENTIALS_KEY` como Base64 de 32 bytes; vive únicamente en Vercel. La clave tributaria se cifra AES-256-GCM antes de llegar a la base de datos y jamás vuelve al navegador.
4. En Railway, habilitar la API privada `/v2/rcv/extractions` y configurar su clave interna. El endpoint existente de PlusContable no se modifica.
5. Ejecutar `npm run dev` para desarrollo local.

Sin variables de Supabase, el entorno abre datos demostrativos para revisar la mesa de trabajo. Producción siempre exige una sesión permitida.

## Verificación

- `npm test`
- `npm run lint`
- `npm run build`

La sincronización la inicia el servidor de Caja Clara contra Railway mediante POST autenticado. Railway recibe la clave SII solo durante la extracción; Vercel no la registra, no la incluye en URLs y no expone su texto al cliente.
