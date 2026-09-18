FROM alpine:3.21

RUN apk add --no-cache ca-certificates curl jq msmtp

COPY check.sh /usr/local/bin/check-ovh-stock
RUN chmod 0555 /usr/local/bin/check-ovh-stock

ENTRYPOINT ["/usr/local/bin/check-ovh-stock"]
