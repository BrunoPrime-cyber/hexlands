FROM node:22-alpine
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "server/server.js"]
