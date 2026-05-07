# Build stage - GoDaddy golden alpine-golang image.
# Check available tags: aws s3 cp s3://gd-goldenami-prod-ecr-repolist/gci-metadata.json - | jq '.[] | select(.imageUri | test("alpine-golang"))'
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine-golang:1.25-alpine AS builder

USER root
WORKDIR /app

COPY stripe-service/go.mod stripe-service/go.sum* ./
RUN go mod download

COPY stripe-service/cmd ./cmd
COPY stripe-service/internal ./internal

ARG GIT_SHA=dev
RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w -X main.version=${GIT_SHA}" -o /app/server ./cmd/server

# Runtime stage - GoDaddy golden alpine.
FROM 764525110978.dkr.ecr.us-west-2.amazonaws.com/alpine:3.22

USER root
WORKDIR /app

RUN apk --no-cache add ca-certificates wget

COPY --from=builder /app/server /app/server
RUN chown -R 1000:1000 /app

USER 1000

EXPOSE 4200

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4200/health || exit 1

CMD ["/app/server"]
