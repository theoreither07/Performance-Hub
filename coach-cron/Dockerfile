FROM alpine:3.20

RUN apk add --no-cache curl tzdata bash

COPY loop.sh /loop.sh
RUN chmod +x /loop.sh

ENV TZ=Europe/Vienna

CMD ["/loop.sh"]
