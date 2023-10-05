FROM node

WORKDIR /app

COPY package.json ./
RUN npm install

COPY vite.config.js ./
COPY public/ public/
COPY index.html ./
COPY server.js ./

# RUN npm run build

# Exposition du port correct
EXPOSE 80

# CMD ["node", "server.js"]
CMD npm run dev
