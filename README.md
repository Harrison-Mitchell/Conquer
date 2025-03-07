# Conquer

A youth group web app game where teams complete challenges to collect cash to invest in physical local town sectors - most owned sectors wins - think risk / monopoly. If you're a visual leaner: [view the inspiration for the game](https://www.youtube.com/watch?v=Ep34bvS4Y9Q)

<p align="center">
  <img width="300" src="">
</p>

## Gameplay

- All teams start with $1000 and one sector active
- Sectors slowly release throughout the game
- Teams then invest their money in sectors with the most invested "owning" the territory
- Teams win money by completing challenges that either nets them income or allows them to steal a portion from another team
- Team leaders self adjudicate and are required to submit a photo of the challenge being completed
- Teams must stratagise
	- Do they farm money and invest in strategic locations - at risk that a portion gets stolen?
	- Or do they spread thin and only bid $1 above
	- Seeing other teams locations, do they tactically avoid a hotspot?
- Be careful not to fail challenges, because you lose money
- Gameplay tweaks roll out like: hiding player locations, hiding wallet values and hiding ownership/scores
- Most territories won at the end wins

## Requirements

- High tech knowledge - requires running python on a VPS with a reverse proxy
- `python3` + modules (`pip3 install flask flask-socketio pillow`)
- VPS + reverse proxy e.g. `nginx`

## Standing Up

1. Customise `static/challenges.json`
2. Customise `server.py`
	- Team names / colours in `teamData = `
	- Wallet starting values in `stateData = `
	- % of challenges that are steals in `steal = `
	- Steal % ranges and challenge $ ranges in `teamState[team]["current_challenge"]["reward"] = `
	- Consider changing `@app.route("/")` and `@app.route("/admin")` to something random for security
3. Customise `static/polygons.json`
	- Use Google MyMaps to draw polygons
	- Export as KMZ
	- Use your preferred LLM to write a python script that takes KMZ and exports in `[LAT,LNG],` format
	- Give territories names, see example `polygons.json`
4. Stand up a reverse proxy e.g. nginx:
	<details>
  <summary>`server.conf`</summary>
server {
    listen 80;
    server_name FQDN; # Your domain or IP
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl;
    server_name FQDN; # Your domain or IP
    ssl_certificate /etc/ssl/certs/FQDN.crt; # Path to your certificate
    ssl_certificate_key /etc/ssl/private/FQDN.key; # Path to your key
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    location /socket.io {
        proxy_pass http://127.0.0.1:5000; 
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade; 
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload";
    ssl_stapling on;
    ssl_stapling_verify on;
}
</details>
5. Run `python3 -u server.py 2>&1 | tee -a server.log` (ideally inside a `screen`)

## Limitations

- Does not allow pre-taken photos to be uploaded (this is by design)
- There's no "proper" security, just a random path (if the server is only up for an hour - meh)

## Notes

- There's an `/admin` interface for:
	- Releasing / enabling territories
	- Sending toasts / popups to specific / all teams
	- Manually setting wallet values
	- Altering gameplay states (hiding wallets, locations, scores/ownership)
- There's an `/admin/image-viewer` endpoint for a live feed of challenge photos
- The main page has the following tweaks:
	- `?leader=1` unlocks wagering + challenge submission
	- `?admin=1` disables gameplay tweaks from affecting UI
	- `?purge=1` to wipe team/leader state storage and start fresh
- All uploads go to: `/uploads`
- IOS seems to default to blocking all Safari location requests, you may need to go to IOS settings and change that
- It's not robust / prod ready / fool proof - but if you know what you're doing to debug on the fly, go crazy
- Teams roughly complete 1 challenge every 3 minutes, so for one hour plan for ~20-25 challenges
- Don't @ me for using flask's baked in server over say Gunicorn, this is architectured explicitly around NOT being [web-scale](https://www.youtube.com/watch?v=b2F-DItXtZs)

## TODO

- Don't hang UI waiting for photo to upload on passChallenge + prevent double submits
- Powerups / items?