FROM node:20-bullseye-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg fonts-freefont-ttf fonts-liberation && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
