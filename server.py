import json
import copy
import base64
import io
import glob
import os

from PIL import Image
from datetime import datetime, timedelta
from random import choice, random, randrange
from flask import Flask, render_template, request, Response, redirect, url_for, jsonify, send_from_directory
from flask_socketio import SocketIO, emit, join_room, leave_room

app = Flask(__name__)
app.config["SECRET_KEY"] = "thisdoesntsignanythingbutprobablystillworthchanging"
socketio = SocketIO(app, max_http_buffer_size=50000000, cors_allowed_origins="*")

def initPolygonState():
    with open("static/polygons.json", "r") as polygonFile:
        polygonNames = list(json.load(polygonFile).keys())

    stateData = {
        "enabled": False,
        "wager": 0,
        "owned_by": None,
        "wagers": {team: 0 for team in teamState.keys()}
    }
    polygonData = {key: copy.deepcopy(stateData) for key in polygonNames}
    for name in polygonNames:
        polygonData[name]["display_name"] = name.replace("_", " ").title()
    return polygonData

def initTeamState():
    teamData = {
        "jb": {
            "display_name": "Junior Boys",
            "colour": "#C8E6C9"
        },
        "jg": {
            "display_name": "Junior Girls",
            "colour": "#F06292"
        },
        "sb": {
            "display_name": "Senior Boys",
            "colour": "#B3E5FC"
        },
        "sg": {
            "display_name": "Senior Girls",
            "colour": "#F44336"
        }
    }

    stateData = {
        "wallet": 1000,
        "score": 0,
        "current_challenge": {
            "title": None,
            "description": None,
            "reward": None,
            "steal": None,
            "photo": None
        },
        "completed_challenges": []
    }

    for team in teamData.values():
        team.update(copy.deepcopy(stateData))

    return teamData

def initGameplayState():
    return {
        "playerLocationVisible": True,
        "teamWalletsVisible": True,
        "scoresVisible": True
    }

def initChallenges():
    with open("static/challenges.json", "r", encoding="utf8") as challengesFile:
        return json.load(challengesFile)["challenges"]

def completeChallenge(team):
    challenge = copy.deepcopy(teamState[team]["current_challenge"])
    teamState[team]["completed_challenges"].append(challenge["title"])
    teamState[team]["current_challenge"]["title"] = None
    teamState[team]["current_challenge"]["description"] = None
    teamState[team]["current_challenge"]["steal"] = None
    teamState[team]["current_challenge"]["reward"] = None
    return challenge

@socketio.on("connect")
def connect():
    emit("gameplayUpdate", gameplayState); print(polygonState)
    emit("teamUpdate", teamState); print(teamState)
    emit("polygonUpdate", polygonState); print(polygonState)
    emit("message", "Client connected")

@socketio.on('join')
def handle_join(data):
    print(f'Client joined room {data["room"]}')
    room = data['room']
    join_room(room)

@socketio.on("getChallenge")
def getChallenge(data):
    print(f'{data["team"]} requested challenge')
    team = data["team"]

    if teamState[team]["current_challenge"]["title"]:
        return

    challenge = choice(CHALLENGES)
    if len(teamState[team]["completed_challenges"]) == choice(CHALLENGES):
        teamState[team]["completed_challenges"] = []
    while challenge["title"] in teamState[team]["completed_challenges"]:
        challenge = choice(CHALLENGES)
    teamState[team]["current_challenge"]["title"] = challenge["title"]
    teamState[team]["current_challenge"]["description"] = challenge["description"]
    steal = True if random() <= 0.25 else False
    teamState[team]["current_challenge"]["steal"] = steal
    teamState[team]["current_challenge"]["reward"] = randrange(15, 55) if steal else randrange(250, 2500)
    socketio.emit("teamUpdate", teamState, room=None); print(teamState)
    socketio.emit("alert", {
        "type": "popup-info",
        "title": f'{teamState[team]["current_challenge"]["reward"]}% Steal<br/>{challenge["title"]}' if steal else f'${teamState[team]["current_challenge"]["reward"]}<br/>{challenge["title"]}',
        "message": challenge["description"]
    }, room=team)

@socketio.on("passChallenge")
def passChallenge(data):
    print(f'{data["team"]} passed challenge')
    team, photo = data["team"], data["photo"]

    # Prevent double submit while photo uploads and UI hangs
    if teamState[team]["current_challenge"]["title"] == None:
        return
    else:
        challenge = completeChallenge(team)

    if challenge["steal"]:
        victim = data["victim"]
        transfer = int(teamState[victim]["wallet"] * (challenge["reward"] / 100))
        teamState[victim]["wallet"] -= transfer
        teamState[team]["wallet"] += transfer
        socketio.emit("alert", {
            "type": "toast-success",
            "message": f"{teamState[team]['display_name']} stole ${transfer} from {teamState[victim]['display_name']} by completing '{challenge['title']}'" if gameplayState["teamWalletsVisible"] else f"??? stole $??? from {teamState[victim]['display_name']} by completing '{challenge['title']}'"
        }, room=None)
    
    else:
        teamState[team]["wallet"] += challenge["reward"]
        socketio.emit("alert", {
            "type": "toast-success",
            "message": f"{teamState[team]['display_name']} won ${challenge['reward']} by completing '{challenge['title']}'" if gameplayState["teamWalletsVisible"] else f"??? won $??? by completing '{challenge['title']}'"
        }, room=None)

    photo = photo.split(',')[1]
    file_bytes = base64.b64decode(photo)
    image = Image.open(io.BytesIO(file_bytes))
    challengeName = ''.join([c for c in challenge["title"].lower() if c.islower()])
    image.save(f'uploads/{challengeName}_{team}.jpg')

    socketio.emit("teamUpdate", teamState, room=None); print(teamState)

@socketio.on("failChallenge")
def failChallenge(data):
    print(f'{data["team"]} failed challenge')
    team = data["team"]
    challenge = completeChallenge(data["team"])

    if challenge["steal"]:
        lost = int(teamState[team]["wallet"] * (challenge["reward"] / 100))
    else:
        lost = challenge["reward"]
        
    teamState[team]["wallet"] -= lost
    if teamState[team]["wallet"] < 0:
        teamState[team]["wallet"] = 0
    
    socketio.emit("alert", {
        "type": "toast-error",
        "message": f"{teamState[team]['display_name']} lost ${lost} by failing '{challenge['title']}'" if gameplayState["teamWalletsVisible"] else f"??? lost $??? by failing '{challenge['title']}'"
    }, room=None)

    socketio.emit("teamUpdate", teamState, room=None); print(teamState)

@socketio.on("location")
def updateLocation(data):  
    global lastLocation
    team, uuid, lat, lon = (data["team"], data["uuid"], data["lat"], data["lon"])
    result = next((item for item in locationState if item["uuid"] == uuid), None)
    if result:
        result["lat"] = lat
        result["lon"] = lon
        result["stale"] = 0
    else:
        locationState.append({
            "team": team,
            "uuid": uuid,
            "lat": lat,
            "lon": lon,
            "stale": 0
        })

    if datetime.now() - lastLocation < timedelta(seconds=5):
        return
    lastLocation = datetime.now()

    trimmedUpdate = []
    for update in locationState:
        update["stale"] += 1
        if update["stale"] == 4:
            locationState.remove(update)
        else:
            trimmedUpdate.append({"team": update["team"], "lat": update["lat"], "lon": update["lon"]})

    print(locationState)
    socketio.emit("locationUpdate", trimmedUpdate, room=None)

@socketio.on("wager")
def wager(data):
    print(f'{data["team"]} wagered {data["increase"]} on {data["polygon"]}')
    team, increase, polygon = (data["team"], data["increase"], data["polygon"])

    if not increase:
        emit("alert", {"type": "toast-info", "message": "You didn't wager nothin!"})
        return

    if teamState[team]["wallet"] < increase:
        emit("alert", {"type": "toast-info", "message": "Insufficient funds!"})
        return

    teamState[team]["wallet"] -= increase

    if (polygonState[polygon]["wagers"][team] + increase > max(polygonState[polygon]["wagers"].values()) and
        not (polygonState[polygon]["owned_by"] and polygonState[polygon]["owned_by"] == team)):
        if polygonState[polygon]["owned_by"]:
            teamState[polygonState[polygon]["owned_by"]]["score"] -= 1
            socketio.emit("alert", {
                "type": "toast-warning",
                "message": f"{teamState[team]['display_name']} invested ${increase} more into `{polygonState[polygon]['display_name']}`, stealing it from {teamState[polygonState[polygon]['owned_by']]['display_name']}" if gameplayState["scoresVisible"] else f"??? invested $??? more into ???, stealing it from ???"
            }, room=None)
        else:
            socketio.emit("alert", {
                "type": "toast-warning",
                "message": f"{teamState[team]['display_name']} invested ${increase} into `{polygonState[polygon]['display_name']}`, making them the first to own it" if gameplayState["scoresVisible"] else f"??? invested $??? into ???, making them the first to own it"
            }, room=None)
        teamState[team]["score"] += 1
        polygonState[polygon]["owned_by"] = team
        
    else:
        socketio.emit("alert", {
            "type": "toast-info",
            "message": f"{teamState[team]['display_name']} invested ${increase} more into `{polygonState[polygon]['display_name']}`" if gameplayState["scoresVisible"] else f"??? invested $??? more into ???"
        }, room=None)

    polygonState[polygon]["wagers"][team] += increase
    polygonState[polygon]["wager"] = max(polygonState[polygon]["wagers"].values())

    socketio.emit("polygonUpdate", polygonState, room=None); print(polygonState)
    socketio.emit("teamUpdate", teamState, room=None); print(teamState)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/admin")
def adminPanel():
    return render_template("admin.html",
        polygonState=polygonState,
        gameplayState=gameplayState,
        teamState=teamState
    )

@app.route('/admin/image-viewer')
def imageViewer():
    return render_template("last.html")

@app.route("/admin/image-last")
def imageLast():        
    image_files = glob.glob("uploads/*.jpg")
    if not image_files:
        return make_response("No image found", 200)
    latest_image = max(image_files, key=os.path.getmtime)
    img = Image.open(latest_image)
    img_bytes = io.BytesIO()
    img.save(img_bytes, format=img.format or "JPEG") # Save to memory buffer
    img_bytes.seek(0)
    img_base64 = base64.b64encode(img_bytes.getvalue()).decode()
    return f"data:image/{img.format or 'jpeg'};base64,{img_base64}" # Data URL

@app.route("/admin/enable-polygon", methods=["POST"])
def enablePolygon():
    polygonState[request.form['enabled-polygon']]["enabled"] = True
    socketio.emit("polygonUpdate", polygonState, room=None); print(polygonState)
    socketio.emit("teamUpdate", teamState, room=None); print(teamState)
    return redirect(url_for("adminPanel"))

@app.route("/admin/toggle-gameplay-setting", methods=["POST"])
def toggleGameplaySetting():
    setting = request.form['toggle-gameplay']
    gameplayState[setting] = not gameplayState[setting]
    socketio.emit("gameplayUpdate", gameplayState, room=None); print(polygonState)
    socketio.emit("teamUpdate", teamState, room=None); print(teamState)
    socketio.emit("polygonUpdate", polygonState, room=None); print(polygonState)
    return redirect(url_for("adminPanel"))

@app.route("/admin/alert", methods=["POST"])
def sendAlert():
    text, team = request.form['text'], request.form['team']
    form, icon = request.form['form'], request.form['icon']
    socketio.emit("alert",
        {"type": f"{form}-{icon}", "message": text},
        room=None if not team else team
    )
    return redirect(url_for("adminPanel"))

@app.route("/admin/set-wallet", methods=["POST"])
def setWallet():
    amount, team = request.form['amount'], request.form['team']
    teamState[team]["wallet"] = int(amount)
    socketio.emit("teamUpdate", teamState, room=None); print(teamState)
    return redirect(url_for("adminPanel"))

teamState = initTeamState()
polygonState = initPolygonState()
gameplayState = initGameplayState()
locationState = []
lastLocation = datetime.now()
CHALLENGES = initChallenges()

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
