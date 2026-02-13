#!/bin/bash

# ==============================================
# WaPro - Setup Script
# ==============================================

set -e

echo "🚀 Iniciando setup de WaPro..."
echo ""

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Función para mostrar mensajes
info() {
    echo -e "${GREEN}✓${NC} $1"
}

warn() {
    echo -e "${YELLOW}⚠${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1"
    exit 1
}

# Verificar que estamos en el directorio correcto
if [ ! -f "package-lock.json" ]; then
    error "Este script debe ejecutarse desde el directorio raíz del proyecto"
fi

# Verificar dependencias del sistema
echo "📋 Verificando dependencias del sistema..."

# Node.js
if ! command -v node &> /dev/null; then
    error "Node.js no está instalado. Instalar desde https://nodejs.org/"
fi
NODE_VERSION=$(node -v)
info "Node.js $NODE_VERSION instalado"

# npm
if ! command -v npm &> /dev/null; then
    error "npm no está instalado"
fi
NPM_VERSION=$(npm -v)
info "npm $NPM_VERSION instalado"

# Docker (opcional)
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker -v | cut -d ' ' -f3 | sed 's/,//')
    info "Docker $DOCKER_VERSION instalado"
    HAS_DOCKER=true
else
    warn "Docker no está instalado (opcional)"
    HAS_DOCKER=false
fi

# Docker Compose (opcional)
if command -v docker-compose &> /dev/null; then
    COMPOSE_VERSION=$(docker-compose -v | cut -d ' ' -f4 | sed 's/,//')
    info "Docker Compose $COMPOSE_VERSION instalado"
    HAS_COMPOSE=true
else
    warn "Docker Compose no está instalado (opcional)"
    HAS_COMPOSE=false
fi

echo ""

# Crear archivo .env si no existe
if [ ! -f ".env" ]; then
    echo "📝 Creando archivo .env..."
    cp .env.example .env
    info "Archivo .env creado. Por favor, edítalo con tus configuraciones."
    warn "IMPORTANTE: Cambia los valores de JWT_SECRET y contraseñas antes de continuar"
    echo ""
    read -p "Presiona Enter para continuar después de editar .env..."
else
    info "Archivo .env ya existe"
fi

echo ""

# Preguntar método de instalación
echo "¿Cómo deseas instalar el proyecto?"
echo "1) Con Docker (recomendado)"
echo "2) Instalación local (sin Docker)"
echo ""
read -p "Selecciona una opción (1 o 2): " INSTALL_METHOD

if [ "$INSTALL_METHOD" = "1" ]; then
    # Instalación con Docker
    if [ "$HAS_DOCKER" = false ] || [ "$HAS_COMPOSE" = false ]; then
        error "Docker y Docker Compose son necesarios para esta opción"
    fi
    
    echo ""
    echo "🐳 Instalando con Docker..."
    echo ""
    
    # Construir imágenes
    echo "📦 Construyendo imágenes Docker..."
    docker-compose -f docker-compose.dev.yml build
    info "Imágenes construidas"
    
    # Levantar servicios
    echo ""
    echo "🚀 Levantando servicios..."
    docker-compose -f docker-compose.dev.yml up -d postgres redis
    info "Base de datos y Redis iniciados"
    
    # Esperar a que Postgres esté listo
    echo ""
    echo "⏳ Esperando a que Postgres esté listo..."
    sleep 10
    
    # Ejecutar migraciones
    echo ""
    echo "🔄 Ejecutando migraciones de base de datos..."
    docker-compose -f docker-compose.dev.yml run --rm panel-backend npm run db:migrate
    info "Migraciones completadas"
    
    # Ejecutar seeds
    echo ""
    echo "🌱 Ejecutando seeds..."
    docker-compose -f docker-compose.dev.yml run --rm panel-backend npm run db:seed
    info "Seeds completados"
    
    # Levantar todos los servicios
    echo ""
    echo "🚀 Levantando todos los servicios..."
    docker-compose -f docker-compose.dev.yml up -d
    info "Todos los servicios iniciados"
    
    echo ""
    info "✅ Instalación con Docker completada!"
    echo ""
    echo "📋 Servicios disponibles:"
    echo "   - Panel Frontend: http://localhost:3001"
    echo "   - Panel Backend:  http://localhost:3000"
    echo "   - Evolution API:  http://localhost:8080"
    echo "   - Bot Service:    http://localhost:3002"
    echo ""
    echo "Para ver logs: docker-compose -f docker-compose.dev.yml logs -f"
    echo "Para detener:  docker-compose -f docker-compose.dev.yml down"
    
else
    # Instalación local
    echo ""
    echo "💻 Instalación local..."
    echo ""
    
    # Verificar que PostgreSQL y Redis estén corriendo
    warn "Asegúrate de que PostgreSQL y Redis estén corriendo localmente"
    echo ""
    read -p "¿PostgreSQL y Redis están corriendo? (s/n): " DB_READY
    
    if [ "$DB_READY" != "s" ]; then
        error "Por favor, inicia PostgreSQL y Redis antes de continuar"
    fi
    
    # Instalar dependencias de cada servicio
    echo ""
    echo "📦 Instalando dependencias..."
    
    # Evolution API
    echo ""
    echo "Installing Evolution API dependencies..."
    cd apps/evolution-api
    npm install
    cd ../..
    info "Evolution API dependencies installed"
    
    # Panel Backend
    echo ""
    echo "Installing Panel Backend dependencies..."
    cd apps/panel-whaticket/backend
    npm install
    cd ../../..
    info "Panel Backend dependencies installed"
    
    # Panel Frontend
    echo ""
    echo "Installing Panel Frontend dependencies..."
    cd apps/panel-whaticket/frontend
    npm install
    cd ../../..
    info "Panel Frontend dependencies installed"
    
    # Bot
    echo ""
    echo "Installing Bot dependencies..."
    cd apps/bot
    npm install
    cd ../..
    info "Bot dependencies installed"
    
    # Evolution Manager
    echo ""
    echo "Installing Evolution Manager dependencies..."
    cd apps/evolution-manager
    npm install
    cd ../..
    info "Evolution Manager dependencies installed"
    
    # Gateway Meta
    echo ""
    echo "Installing Gateway Meta dependencies..."
    cd apps/gateway-meta
    npm install
    cd ../..
    info "Gateway Meta dependencies installed"
    
    # Ejecutar migraciones
    echo ""
    echo "🔄 Ejecutando migraciones..."
    cd apps/panel-whaticket/backend
    npm run db:migrate
    npm run db:seed
    cd ../../..
    info "Migraciones completadas"
    
    # Ejecutar migraciones de Evolution API
    cd apps/evolution-api
    npm run db:generate
    npm run db:deploy
    cd ../..
    info "Evolution API migrations completed"
    
    echo ""
    info "✅ Instalación local completada!"
    echo ""
    echo "📋 Para iniciar los servicios:"
    echo ""
    echo "Terminal 1: cd apps/evolution-api && npm run dev"
    echo "Terminal 2: cd apps/panel-whaticket/backend && npm run dev"
    echo "Terminal 3: cd apps/panel-whaticket/frontend && npm run dev"
    echo "Terminal 4: cd apps/bot && npm run dev"
    echo ""
    echo "O usa: npm run dev:all (si el script está configurado)"
fi

echo ""
echo "🎉 ¡Setup completado!"
echo ""
echo "📚 Próximos pasos:"
echo "   1. Accede al panel: http://localhost:3001"
echo "   2. Login con: admin@wapro.com / admin123 (cambiar después)"
echo "   3. Conecta tu WhatsApp desde Conexiones"
echo ""
echo "📖 Documentación: Ver README.md"
echo "🐛 Problemas: Revisa los logs o crea un issue"
echo ""
