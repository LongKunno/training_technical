FROM golang:1.25-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/core-trading ./cmd/api

FROM alpine:3.20

RUN addgroup -S app && adduser -S -G app app \
    && apk add --no-cache ca-certificates

COPY --from=build /out/core-trading /usr/local/bin/core-trading

USER app

EXPOSE 8080

CMD ["core-trading"]
