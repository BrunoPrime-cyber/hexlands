# Hexlands server

Zero dependencies. Needs Node.js 20 or newer (https://nodejs.org, LTS).

## Play with friends on the same Wi-Fi (local game)

1. Windows: double-click `start.bat`. Mac/Linux: run `./start.sh`.
2. The window prints two addresses. Open the `http://localhost:3000` one on your own computer.
   Friends open the `Same Wi-Fi/LAN` address (looks like `http://192.168.x.x:3000`) on their phones or computers.
3. Press "Start a new table", then give friends the 4-letter room code. Empty seats can be filled with bots.
4. If Windows asks about the firewall the first time, allow Node.js on private networks.

## Play with friends over the internet (online game)

Easiest, no account: keep the server running on your computer and open a free tunnel to it.
Install `cloudflared` (https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and run

    cloudflared tunnel --url http://localhost:3000

It prints an `https://something.trycloudflare.com` address. Send that address and the room code to your friends.
The game works only while your computer and both windows stay open, and the address changes each time.

Always-on: put this folder on a host that runs Docker or Node.
- Render: push this folder to a GitHub repo, create a new "Web Service" from it, choose Docker, free plan. `render.yaml` is included.
  Free services go to sleep when idle and forget tables when they restart.
- Any VPS: `PORT=3000 node server/server.js` behind your usual HTTPS proxy. Turn off proxy buffering for `/api/stream` (the server already sends `X-Accel-Buffering: no`).

## Settings (environment variables)

- `PORT` (default 3000), `HOST` (default 0.0.0.0)
- `HEXLANDS_DATA` where tables are saved (default `data/rooms.json`), `HEXLANDS_NO_PERSIST=1` to turn saving off
