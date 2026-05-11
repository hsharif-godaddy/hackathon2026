# Build stage - GoDaddy golden alpine-golang image.
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

USER root
WORKDIR /app

# Copy packages/go-auth to satisfy the replace directive in go.mod:
#   replace .../packages/go-auth => ../packages/go-auth
# With WORKDIR=/app, that resolves to /packages/go-auth inside the container.
COPY packages/go-auth /packages/go-auth

COPY stripe-service/go.mod stripe-service/go.sum ./

# JFrog OIDC token mounted as a build secret pulls private gdcorp-golang modules
# (transitive deps of packages/go-auth) from JFrog Artifactory. The token is
# scoped to this RUN command and is never persisted in any image layer.
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt|direct" \
    GONOSUMDB="github.com/gdcorp-golang/*" \
    GOFLAGS="-mod=mod" \
    go mod download

COPY stripe-service/cmd ./cmd
COPY stripe-service/internal ./internal

ARG GIT_SHA=dev
RUN --mount=type=secret,id=jfrog_token \
    JFROG_TOKEN=$(cat /run/secrets/jfrog_token) \
    GOPROXY="https://:${JFROG_TOKEN}@gdartifactory1.jfrog.io/artifactory/api/go/go-virt|direct" \
    GONOSUMDB="github.com/gdcorp-golang/*" \
    GOFLAGS="-mod=mod" \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w -X main.version=${GIT_SHA}" -o /app/server ./cmd/server

# Runtime stage - GoDaddy golden alpine.
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

USER root
WORKDIR /app

RUN apk --no-cache add ca-certificates wget openssl

RUN mkdir -p /app/certs && \
    openssl req -x509 -newkey rsa:2048 \
    -keyout /app/certs/server.key -out /app/certs/server.crt \
    -days 365 -nodes -subj "/CN=stripe-service" \
    -addext "subjectAltName=DNS:*,IP:127.0.0.1,IP:0.0.0.0" && \
    chmod 644 /app/certs/server.crt && \
    chmod 600 /app/certs/server.key && \
    chown 1000:1000 /app/certs/server.key /app/certs/server.crt

COPY --from=builder /app/server /app/server
RUN chown -R 1000:1000 /app

USER 1000

ENV SERVER_CERT_PATH=/app/certs/server.crt
ENV SERVER_KEY_PATH=/app/certs/server.key

EXPOSE 8443

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider --no-check-certificate https://localhost:8443/health || exit 1

CMD ["/app/server"]
