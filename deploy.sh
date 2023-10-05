sudo certbot certonly --manual --preferred-challenges=dns --email blancxav@gmail.com --agree-tos -d vanillacademy.com -d *.vanillacademy.com
sudo systemctl stop nginx  
sudo docker compose up