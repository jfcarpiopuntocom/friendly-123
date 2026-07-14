FROM alpine:3.19

ARG PB_VERSION=0.22.21

# Descarga el binario de PocketBase para Linux x86_64.
# Para ARM (Raspberry Pi, Apple Silicon) cambiar a:
# https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_arm64.zip
RUN apk add --no-cache curl unzip ca-certificates && \
    curl -fsSL "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_amd64.zip" \
    -o /tmp/pb.zip && \
    unzip /tmp/pb.zip -d /pb && \
    rm /tmp/pb.zip && \
    chmod +x /pb/pocketbase

EXPOSE 8090

VOLUME /pb/pb_data

CMD ["/pb/pocketbase", "serve", "--http=0.0.0.0:8090", "--dir=/pb/pb_data"]
