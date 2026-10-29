# The app, served by nginx:           docker build -t system-design .
#                                     docker run -p 8080:80 system-design
# The command-line tool:              docker build --target cli -t sdp .
#                                     docker run --rm -v "$PWD:/work" -w /work sdp check board.json

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Served from the root here, not from the GitHub Pages path.
ENV BASE_PATH=/
RUN npm run build

FROM node:22-alpine AS cli
# The tool runs straight from source: Node 22 reads TypeScript itself.
COPY package.json /sdp/package.json
COPY src /sdp/src
COPY bin /sdp/bin
ENTRYPOINT ["node", "/sdp/bin/sdp.ts"]

FROM nginx:alpine AS web
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
