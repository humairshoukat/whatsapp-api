FROM node:20

WORKDIR /app
COPY package.json ./
RUN apt-get update && apt-get install -y ffmpeg
RUN npm install
COPY . .

EXPOSE 8000
CMD ["node", "index.js"]
