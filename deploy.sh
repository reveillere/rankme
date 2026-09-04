sudo certbot certonly --manual --preferred-challenges=dns --email laurent@reveillere.fr --agree-tos -d rankme.fr -d *.rankme.fr
sudo systemctl stop nginx
sudo docker compose -f docker-compose.prod.yml up -d --build