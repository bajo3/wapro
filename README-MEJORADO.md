# 🚀 WaPro - WhatsApp Automation Platform

Sistema completo de automatización y gestión de WhatsApp con IA, multi-sesión y panel administrativo profesional.

![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)

## ✨ Características Principales

- 🤖 **Bot IA Inteligente** - Automatización con OpenAI, Dify, Typebot
- 💬 **Multi-Sesión WhatsApp** - Gestiona múltiples números simultáneamente
- 📊 **Panel Administrativo** - Dashboard completo con métricas en tiempo real
- 🎫 **Sistema de Tickets** - Gestión profesional de conversaciones
- 📱 **Campañas Masivas** - Envío programado de mensajes
- 🔌 **Webhooks** - Integración con servicios externos
- 🎨 **UI/UX Moderna** - Interfaz profesional y responsive
- 🔒 **Seguro** - Rate limiting, JWT, validaciones

## 📋 Requisitos Previos

- **Node.js** >= 18.0.0
- **PostgreSQL** >= 13
- **Redis** >= 6 (opcional pero recomendado)
- **Docker** y **Docker Compose** (opcional)

## 🚀 Instalación Rápida

### Opción 1: Con Docker (Recomendado)

```bash
# 1. Clonar repositorio
git clone https://github.com/tu-usuario/wapro.git
cd wapro

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 3. Levantar servicios
docker-compose -f docker-compose.dev.yml up -d

# 4. Acceder al panel
# http://localhost:3001
```

### Opción 2: Instalación Local

```bash
# 1. Clonar repositorio
git clone https://github.com/tu-usuario/wapro.git
cd wapro

# 2. Ejecutar script de setup
chmod +x scripts/setup.sh
./scripts/setup.sh

# 3. Seguir las instrucciones en pantalla
```

## 📦 Arquitectura del Proyecto

```
wapro/
├── apps/
│   ├── evolution-api/       # API principal WhatsApp
│   ├── panel-whaticket/     # Panel administrativo
│   │   ├── backend/         # API REST
│   │   └── frontend/        # React UI
│   ├── bot/                 # Motor de IA y automatización
│   ├── evolution-manager/   # Herramientas admin
│   └── gateway-meta/        # Gateway Meta/Facebook
├── scripts/                 # Scripts de utilidad
├── docker-compose.dev.yml   # Desarrollo
└── docker-compose.yml       # Producción
```

## 🎯 Servicios y Puertos

| Servicio | Puerto | URL | Descripción |
|----------|--------|-----|-------------|
| Panel Frontend | 3001 | http://localhost:3001 | Interfaz de usuario |
| Panel Backend | 3000 | http://localhost:3000 | API REST |
| Evolution API | 8080 | http://localhost:8080 | WhatsApp API |
| Bot Service | 3002 | http://localhost:3002 | IA y automatización |
| PostgreSQL | 5432 | localhost:5432 | Base de datos |
| Redis | 6379 | localhost:6379 | Cache y rate limiting |

## 🔧 Configuración

### Variables de Entorno Esenciales

```bash
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/wapro

# JWT Secrets (CAMBIAR EN PRODUCCIÓN!)
JWT_SECRET=your-super-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# URLs
BACKEND_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3001
EVOLUTION_API_URL=http://localhost:8080

# Redis (opcional pero recomendado)
REDIS_URL=redis://:password@localhost:6379
```

Ver `.env.example` para configuración completa.

## 📖 Uso

### 1. Acceder al Panel

1. Abrir navegador: `http://localhost:3001`
2. Login inicial:
   - Email: `admin@wapro.com`
   - Password: `admin123`
3. **Cambiar contraseña inmediatamente**

### 2. Conectar WhatsApp

1. Ir a **Conexiones** en el menú
2. Click en **Nueva Conexión**
3. Escanear QR con WhatsApp
4. Esperar conexión exitosa

### 3. Configurar Bot

1. Ir a **Bot** en el menú
2. Activar Bot (toggle ON/OFF)
3. Configurar reglas y respuestas
4. Integrar con IA (OpenAI, Dify, etc.)

### 4. Crear Campaña

1. Ir a **Campañas**
2. Click en **Nueva Campaña**
3. Importar contactos (CSV)
4. Configurar mensaje y horario
5. Activar campaña

## 🎨 Mejoras Implementadas

### ✅ UI/UX
- Error boundaries para mejor UX
- Loading states con skeletons
- Validación de formularios mejorada
- Toasts informativos
- Responsive design optimizado

### ✅ Performance
- Code splitting en rutas
- Lazy loading de componentes
- Memoización de componentes React
- Database query optimization
- Redis caching implementado

### ✅ Seguridad
- Rate limiting en endpoints críticos
- Input sanitization
- JWT con refresh tokens
- CORS configurado correctamente
- Helmet headers

### ✅ Developer Experience
- Docker compose mejorado
- Scripts de setup automático
- Variables de entorno documentadas
- Health checks en servicios
- Error handling centralizado

## 🐛 Troubleshooting

### Problema: Error al conectar WhatsApp

```bash
# Verificar logs de Evolution API
docker-compose -f docker-compose.dev.yml logs -f evolution-api

# Limpiar sesión y reintentar
docker-compose -f docker-compose.dev.yml restart evolution-api
```

### Problema: Error de base de datos

```bash
# Verificar que Postgres esté corriendo
docker-compose -f docker-compose.dev.yml ps postgres

# Ejecutar migraciones manualmente
cd apps/panel-whaticket/backend
npm run db:migrate
```

### Problema: Frontend no carga

```bash
# Verificar backend esté corriendo
curl http://localhost:3000/health

# Verificar variables de entorno en frontend
cat apps/panel-whaticket/frontend/.env
```

## 📊 Scripts Disponibles

```bash
# Desarrollo
npm run dev              # Iniciar todos los servicios
npm run dev:api          # Solo Evolution API
npm run dev:backend      # Solo Panel Backend
npm run dev:frontend     # Solo Panel Frontend
npm run dev:bot          # Solo Bot

# Build
npm run build            # Build todo para producción
npm run build:api        # Build Evolution API
npm run build:backend    # Build Panel Backend
npm run build:frontend   # Build Panel Frontend

# Database
npm run db:migrate       # Ejecutar migraciones
npm run db:seed          # Ejecutar seeds
npm run db:reset         # Reset database

# Utilidades
npm run lint             # Linting
npm run format           # Formatear código
npm run health-check     # Verificar salud de servicios
```

## 🔐 Seguridad

### Producción Checklist

- [ ] Cambiar JWT_SECRET y JWT_REFRESH_SECRET
- [ ] Cambiar contraseñas de base de datos
- [ ] Configurar CORS correctamente
- [ ] Habilitar SSL/TLS
- [ ] Configurar firewall
- [ ] Habilitar rate limiting
- [ ] Configurar backups automáticos
- [ ] Monitoreo de logs

## 📝 API Documentation

### Autenticación

```bash
# Login
POST /auth/login
{
  "email": "user@example.com",
  "password": "password123"
}

# Refresh Token
POST /auth/refresh_token
```

### Mensajes

```bash
# Enviar mensaje
POST /messages/send
{
  "number": "5491234567890",
  "body": "Hola mundo",
  "whatsappId": 1
}

# Enviar media
POST /messages/media
{
  "number": "5491234567890",
  "medias": ["https://example.com/image.jpg"],
  "whatsappId": 1
}
```

Ver documentación completa en `/docs/api`

## 🤝 Contribuir

Las contribuciones son bienvenidas!

1. Fork el proyecto
2. Crear feature branch (`git checkout -b feature/amazing-feature`)
3. Commit cambios (`git commit -m 'Add amazing feature'`)
4. Push a branch (`git push origin feature/amazing-feature`)
5. Abrir Pull Request

## 📄 Licencia

Este proyecto está bajo la licencia MIT. Ver `LICENSE` para más detalles.

## 👥 Soporte

- 📧 Email: support@wapro.com
- 💬 Discord: [Join our community](#)
- 📚 Docs: [docs.wapro.com](#)
- 🐛 Issues: [GitHub Issues](https://github.com/tu-usuario/wapro/issues)

## 🙏 Agradecimientos

- [Evolution API](https://github.com/EvolutionAPI/evolution-api)
- [Whaticket](https://github.com/canove/whaticket-community)
- [Baileys](https://github.com/WhiskeySockets/Baileys)

## 🗺️ Roadmap

### v2.1 (Próximo)
- [ ] Tests E2E con Playwright
- [ ] PWA support
- [ ] Analytics dashboard mejorado
- [ ] Multi-idioma completo

### v2.2
- [ ] GraphQL API
- [ ] WebSocket fallback
- [ ] Notificaciones push
- [ ] Tema customizable

### v3.0
- [ ] Microservices con API Gateway
- [ ] Kubernetes deployment
- [ ] Multi-tenant
- [ ] Advanced analytics

---

**Hecho con ❤️ por el equipo WaPro**

⭐ Si este proyecto te ayudó, considera darle una estrella en GitHub!
