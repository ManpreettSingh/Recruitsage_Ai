#!/usr/bin/env bash
# ==============================================================================
# RecruitSage Backend - Automated Production EC2 Deployment Script
# Target OS: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS
# ==============================================================================

set -e

echo "=========================================================="
echo " Starting RecruitSage Backend Setup on AWS EC2"
echo "=========================================================="

APP_DIR="/opt/recruitsage"
SERVICE_NAME="recruitsage"

# 1. Update system packages
echo "[1/6] Updating Ubuntu package lists and installing dependencies..."
sudo apt-get update -y
sudo apt-get install -y python3 python3-pip python3-venv git nginx certbot python3-certbot-nginx curl ufw

# 2. Configure Firewall (UFW)
echo "[2/6] Configuring Firewall (SSH, HTTP, HTTPS)..."
sudo ufw allow 'OpenSSH'
sudo ufw allow 'Nginx Full'
sudo ufw --force enable || true

# 3. Create app directory if not exists
echo "[3/6] Setting up project directory at $APP_DIR..."
sudo mkdir -p $APP_DIR
sudo chown -R $USER:$USER $APP_DIR

if [ ! -f "$APP_DIR/run_backend.sh" ]; then
    echo "Please copy or git clone your project repository into $APP_DIR"
    echo "Example: git clone <YOUR_REPO_URL> $APP_DIR"
fi

# 4. Install Node.js & build TypeScript backend
echo "[4/6] Installing Node.js & building TypeScript backend..."
if ! command -v node > /dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

cd $APP_DIR/backend
npm install
npm run build

# 5. Create systemd daemon service
echo "[5/6] Creating systemd service ($SERVICE_NAME.service)..."
NODE_BIN=$(which node)
sudo tee /etc/systemd/system/$SERVICE_NAME.service > /dev/null <<EOF
[Unit]
Description=RecruitSage Placement Copilot Backend (Node.js/TypeScript)
After=network.target

[Service]
User=$USER
WorkingDirectory=$APP_DIR/backend
Environment=PORT=8000
Environment=NODE_ENV=production
ExecStart=$NODE_BIN dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable $SERVICE_NAME
sudo systemctl restart $SERVICE_NAME

# 6. Configure Nginx Reverse Proxy
echo "[6/6] Configuring Nginx reverse proxy..."
sudo tee /etc/nginx/sites-available/$SERVICE_NAME > /dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    server_name _;

    client_max_body_size 30M;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_buffering off;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/$SERVICE_NAME /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "=========================================================="
echo " RecruitSage Backend is LIVE on Port 80!"
echo " Status check: sudo systemctl status $SERVICE_NAME"
echo " To enable HTTPS with a domain name:"
echo "   sudo certbot --nginx -d your-domain.com"
echo "=========================================================="
