# Local E2E only — not used in production.
FROM golang:1.25-alpine AS build
WORKDIR /app
COPY main.go .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /sink main.go

FROM alpine:3.21
USER nobody
COPY --from=build /sink /sink
EXPOSE 9090
ENTRYPOINT ["/sink"]
