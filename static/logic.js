//
// Global vars, sue me
//

const mapCenter = [-33.81414167228876, 151.169585479603]
const mapZoom = 16

const socket = io();
let polygonCoords = null;
let polygons = [];
let team = localStorage.getItem("team")
let leader = localStorage.getItem("leader")
let admin = localStorage.getItem("admin")
let teamState = null
let polygonState = null
let gameplayState = null
let locationState = []
let challenge = null
let uuid = null
let markers = []
let map = null
let standingIn = null

//
// Init functions
//

// If ?purge=1 in URL, nuke all local storage
if (new URLSearchParams(window.location.search).get('purge') === '1') {
	localStorage.clear();
	window.history.pushState({}, '', window.location.pathname);
}

// If ?leader=1 in URL, save leader and hide from URL
if (new URLSearchParams(window.location.search).get('leader') === '1') {
	localStorage.setItem('leader', 'true');
	leader = true
	window.history.pushState({}, '', window.location.pathname);
}

// If ?admin=1 in URL, save admin and hide from URL
if (new URLSearchParams(window.location.search).get('admin') === '1') {
	localStorage.setItem('admin', 'true');
	admin = true
	window.history.pushState({}, '', window.location.pathname);
}

// Selectively display functions if leader
if (leader) {
	document.getElementById("wager-table").style.display = "table"
	document.getElementById("challenge-button").style.display = "inline-block"
	document.getElementById("challenge-buttons").style.display = "block"
}

// Create a unique session identifier for location tracking
if (localStorage.getItem("uuid")) {
	uuid = localStorage.getItem("uuid");
} else {
	uuid = window.location.protocol === 'https:' ? crypto.randomUUID().split("-")[0] : String.fromCharCode(97 + Math.floor(Math.random() * 26));
	localStorage.getItem("uuid", uuid);
}

// Fetch the static polygon data
fetch('static/polygons.json')
	.then(response => response.json())
	.then(data => {
		polygonCoords = data;
		erectMap()
		setTimeout(() => { polygonUpdate(polygonState) }, 200);
	})

// Init leaflet map and draw initial territories
function erectMap() {
	map = L.map('map', {
		zoomControl: false,
	}).setView(mapCenter, mapZoom);

	// L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
	L.tileLayer('https://api.mapbox.com/styles/v1/mapbox/dark-v10/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoiaGF6emFoYXp6YW0iLCJhIjoiY2tta2Q1bzE4MGlieTJwbHNmaTNzaGJveiJ9.r8e_aIAd8sSPf4LU7GHLuA', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
	}).addTo(map);

	for (const key in polygonCoords) {
		polygons.push(
			L.polygon(polygonCoords[key].map(coord => [coord[1], coord[0]]), {
				color: '#000',
				fillOpacity: 0,
				opacity: 0,
				name: key,
				enabled: true
			}).bindPopup()
			.on('click', (e) => {
				e.target.openPopup();
			})
			.addTo(map)
		)
	}
	// Debug helper
	// map.on('contextmenu', (e) => {
	// 	lat = e.latlng.lat;
	// 	lon = e.latlng.lng;
	// });
}

// Setup 5-secondly location updates
function initLocationUpdates() {
		navigator.geolocation.getCurrentPosition((position) => {
			const lat = position.coords.latitude;
			const lon = position.coords.longitude;
			locationState = [lat, lon]
			socket.emit('location', { "team": team, "uuid": uuid, "lat": lat, "lon": lon });

			// Disable wagering if not in a territory
			standingIn = containingPolygon(locationState)
			document.getElementById("wager-location").innerText = "🗺️ Currently in: " + (standingIn ? polygonState[standingIn]["display_name"] : "No Man's Land")
			if (leader) {
				document.getElementById("wager-input").style.display = standingIn ? "inline-block" : "none"
				document.getElementById("wager-submit").style.display = standingIn ? "inline-block" : "none"
			} 
		}, (error) => {
			if (error.code === error.PERMISSION_DENIED) {

			}
		});
		setTimeout(initLocationUpdates, 5000);
}

// On first load, show team picker and commit to memory
// Once team is set, update all UI elements
async function initTeam() {
	if (team == null) {
		let options = {}
		for (let i = 0; i < Object.keys(teamState).length; i++) {
			options[Object.keys(teamState)[i]] = teamState[Object.keys(teamState)[i]]["display_name"]
		}
		const { value: selectedTeam } = await Swal.fire({
			title: "Select Your Team",
			input: "select",
			inputOptions: options,
			allowOutsideClick: false,
			backdrop: "#fff",
			inputPlaceholder: "...",
			inputValidator: (value) => {
				return new Promise((resolve) => {
					if (value) {
						resolve();
					} else {
						resolve("Oi! You have to pick one...");
					}
				});
			}
		});
		if (selectedTeam) {
			localStorage.setItem("team", selectedTeam)
			team = selectedTeam
			updatePolygonTable(polygonState)
			updateTeamTable(teamState)
			challenge = teamState[team]["current_challenge"]
			updateChallengeTable(challenge)
		}
	}
	// Thick coloured border to spot team switcher cheaters
	document.documentElement.style.border = `15px solid ${teamState[team]["colour"]}`
	socket.emit('join', { room: team });
	initLocationUpdates()
}

//
// Helper functions
//

// Given a coord, return the polygon that contains it
function containingPolygon(coord) {
	for (var i = 0; i < polygons.length; i++) {
		let inside = pointInPolygon(coord, polygons[i])
		if (inside && polygonState[i]["enabled"]) {
			return polygons[i].options.name;
		}
	}
	return null;
}

// Given a coord and a polygon bounds, check if the point is inside
function pointInPolygon(coord, poly) {
	var polyPoints = poly.getLatLngs()[0];
	var x = coord[0], y = coord[1];
	var inside = false;
	for (var i = 0, j = polyPoints.length - 1; i < polyPoints.length; j = i++) {
		var xi = polyPoints[i].lat, yi = polyPoints[i].lng;
		var xj = polyPoints[j].lat, yj = polyPoints[j].lng;
		var intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
		if (intersect) inside = !inside;
	}
	return inside;
};

// Format polygon data from dicts to array of arrays for the table
function updatePolygonTable(data) {
	let headers = ["📍 Location", "💵 Invested", "👑 Owned By"]
	let cleanedData = []
	let polygons = Object.keys(data)
	for (let i = 0; i < polygons.length; i++) {
		cleanedData.push([
			data[polygons[i]]["display_name"],
			`$${data[polygons[i]]["wagers"][team]}`,
			(gameplayState["scoresVisible"] || data[polygons[i]]["owned_by"] == team || admin) ? (data[polygons[i]]["owned_by"] ? `${teamState[data[polygons[i]]["owned_by"]]["display_name"]} ($${data[polygons[i]]["wager"]})` : "-") : (data[polygons[i]]["owned_by"] ? `??? ($${data[polygons[i]]["wager"]})` : "-"),
			(gameplayState["scoresVisible"] || data[polygons[i]]["owned_by"] == team || admin) ? (data[polygons[i]]["owned_by"] ? teamState[data[polygons[i]]["owned_by"]]["colour"] : "#fff") : "#fff",
			data[polygons[i]]["owned_by"] == team
		])
	}
	cleanedData = cleanedData.sort((a, b) => b[1].localeCompare(a[1]))
	arraysToTable("polygon", [headers, ...cleanedData])
}

// Format team data from dicts to array of arrays for the table
function updateTeamTable(data) {
	let headers = ["👨‍👨‍👦‍👦 Team", "💵 Wallet", "🏆 Owned"]
	let cleanedData = []
	let teams = Object.keys(data)
	for (let i = 0; i < teams.length; i++) {
		cleanedData.push([
			data[teams[i]]["display_name"],
			(gameplayState["teamWalletsVisible"] || teams[i] == team || admin) ? `$${data[teams[i]]["wallet"]}` : "???",
			(gameplayState["scoresVisible"] || teams[i] == team || admin) ? data[teams[i]]["score"] : "???",
			data[teams[i]]["colour"],
			teams[i] == team
		])
	}
	cleanedData = cleanedData.sort((a, b) => b[2] - a[2])
	arraysToTable("team", [headers, ...cleanedData])
}

// Selectively hide challenge UI elements based on active status and leaderness
function updateChallengeTable(challenge) {
	if (challenge["title"]) {
		document.getElementById("challenge-table").style.display = "table"
		document.getElementById("challenge-button").style.display = "inline-block"
		document.getElementById("challenge-button").innerText = challenge["steal"] ? `${challenge["reward"]}%: ${challenge["title"]}` : `$${challenge["reward"]}: ${challenge["title"]}`
		document.getElementById("challenge-photo").disabled = false;
		document.getElementById("challenge-camera").disabled = false;
		document.getElementById("challenge-pass").disabled = false;
		document.getElementById("challenge-fail").disabled = false;
	} else {
		document.getElementById("challenge-button").innerText = "Request"
		if (!leader) document.getElementById("challenge-table").style.display = "none"
		document.getElementById("challenge-photo").disabled = true;
		document.getElementById("challenge-photo").value = "";
		document.getElementById("challenge-camera").disabled = true;
		document.getElementById("challenge-camera").style = "";
		document.getElementById("challenge-pass").disabled = true;
		document.getElementById("challenge-fail").disabled = true;
	}
}

// Take array of arrays and turn it into an HTML table
function arraysToTable(table, data) {
	// Find and wipe the table
	table = document.getElementById(`${table}-table`);
	table.replaceChildren();

	// Create the header row
	const headerRow = document.createElement("tr");
	data[0].forEach((header) => {
		const th = document.createElement("th");
		th.textContent = header;
		headerRow.appendChild(th);
	});
	table.appendChild(headerRow);

	// Create the data rows
	for (let i = 1; i < data.length; i++) {
		const row = document.createElement("tr");
		let texts = data[i].slice(0, -2), fillColour = data[i].slice(-2, -1)[0], highlight = data[i].slice(-1)[0];
		console.log(texts, fillColour, highlight)
		texts.forEach((cell) => {
			const td = document.createElement("td");
			td.textContent = cell;
			row.appendChild(td);
		});
		row.style.background = highlight ? "#ddd" : "#fff"
		row.lastChild.style.background = fillColour
		table.appendChild(row);
	}
}

// Format the popup bubble when clicking a territory on the map
function polygonPopup(name) {
	text = `<h3>${polygonState[name]["display_name"]}</h3>`
	if (polygonState[name]["owned_by"]) {
		text += `<p>Owned by ${teamState[polygonState[name]["owned_by"]]["display_name"]} for $${polygonState[name]["wager"]}</p><ul>`
		wagers = polygonState[name]["wagers"]
		for (let i = 0; i < Object.keys(wagers).length; i++) {
			if (wagers[Object.keys(wagers)[i]] > 0 && Object.keys(wagers)[i] != polygonState[name]["owned_by"]) {
				text += `<li>${teamState[Object.keys(wagers)[i]]["display_name"]}: $${wagers[Object.keys(wagers)[i]]}</li>`
			}
		}
		text += `</ul>`
	}
	return text
}

// Convert the challenge <form> data to websocket format
function submitChallenge(team, victim = null) {
	const file = document.getElementById("challenge-photo").files[0]
	const reader = new FileReader();
	reader.readAsDataURL(file);
	reader.onload = () => {
		const fileData = reader.result;
		console.log(fileData)
		socket.emit('passChallenge', { "team": team, "victim": victim, "photo": fileData });
	};
}

//
// On-click interaction
//

// Send a websocket message when submitting a wager
document.getElementById('wager-submit').addEventListener('click', () => {
	socket.emit('wager', {
		"team": team,
		"increase": parseInt(document.getElementById('wager-input').value),
		"polygon": standingIn
	});
	document.getElementById('wager-input').value = ""
});

// If clicking the challenge button, either fetch a new one or reshow challenge information
document.getElementById('challenge-button').addEventListener('click', () => {
	if (document.getElementById("challenge-button").innerText == "Request") {
		socket.emit('getChallenge', { "team": team });
	} else {
		Swal.fire({
			title: challenge["steal"] ? `${teamState[team]["current_challenge"]["reward"]}% Steal<br/>${challenge["title"]}` : `$${teamState[team]["current_challenge"]["reward"]}<br/>${challenge["title"]}`,
			text: challenge["description"],
			showConfirmButton: false,
			showCloseButton: true,
			icon: "info"
		})
	}
});

// When finishing a challenge, ensure photo is taken and ask for victim team if steal
document.getElementById('challenge-pass').addEventListener('click', () => {
	if (document.getElementById("challenge-photo").files.length == 0) {
		Swal.fire({
			title: "Photo Needed",
			showConfirmButton: false,
			showCloseButton: true,
			icon: "error"
		})
		return
	}
	if (challenge["steal"]) {
		let options = {}
		for (let i = 0; i < Object.keys(teamState).length; i++) {
			if (Object.keys(teamState)[i] != team) {
				options[Object.keys(teamState)[i]] = teamState[Object.keys(teamState)[i]]["display_name"]
			}
		}
		Swal.fire({
			title: "Steal from Which Team?",
			input: "select",
			inputOptions: options,
			inputPlaceholder: "...",
			inputValidator: (value) => {
				return new Promise((resolve) => {
					if (value) {
						resolve();
						submitChallenge(team, value)
					} else {
						resolve("Oi! You have to pick one...");
					}
				});
			}
		});
	} else {
		submitChallenge(team)
	}
});

// Emit a websocket message if the challenge is failed
document.getElementById('challenge-fail').addEventListener('click', () => {
	socket.emit('failChallenge', { "team": team });
});

//
// Websocket connections
//

// Once websocket connection is established, we can init the team and setup the UI
socket.on('connect', () => {
	initTeam()
});

// Selectively hide / show UI with gameplay settings
socket.on('gameplayUpdate', (data) => {
	gameplayState = data
});

// When polygon state data updates, redraw polygons and popup text
socket.on('polygonUpdate', (data) => {
	polygonUpdate(data)
});
function polygonUpdate (data) {
	polygonState = data
	// console.log("I've also got", Object.keys(polygonState))
	// polygons = Object.keys(polygonState)
	console.log("polygon update", polygons)
	for (var i = 0; i < polygons.length; i++) {
		polygonName = polygons[i].options.name
		polygonData = data[polygonName]
		if (polygonData.enabled) polygons[i].setStyle({
			fillOpacity: 0.5,
			opacity: 0.5
		})
		polygons[i].setStyle({
			fillColor: (gameplayState["scoresVisible"] || data[polygonName]["owned_by"] == team || admin) ? (data[polygonName]["owned_by"] ? teamState[data[polygonName]["owned_by"]]["colour"] : "white") : "white"
		})
		if (polygons[i].getPopup()) {
			polygons[i].getPopup().setContent((gameplayState["scoresVisible"] || admin) ? polygonPopup(polygonName) : `<h3>${polygonState[polygonName]["display_name"]}</h3>`)
		}
	}
	polygonState = data
	updatePolygonTable(polygonState)
}

// When team state updates, redraw team table and the current challenge
socket.on('teamUpdate', (data) => {
	teamState = data
	updateTeamTable(teamState)
	if (team) {
		challenge = teamState[team]["current_challenge"]
		updateChallengeTable(challenge)
	}
});

// Every 5 seconds, update pins on the map and redraw current location
socket.on('locationUpdate', (data) => {
	markers.forEach(function (marker) {
		map.removeLayer(marker);
	})
	markers = []
	// All player locations
	data.forEach(function (marker) {
		if (gameplayState["playerLocationVisible"] || (gameplayState["playerLocationVisible"] === false && marker["team"] == team) || admin) {
			pin = L.circleMarker([marker["lat"], marker["lon"]], {
				radius: 4,
				weight: 0,
				fillColor: teamState[marker["team"]]["colour"],
				fillOpacity: 1
			})
			markers.push(pin)
			pin.addTo(map);
		}
	})
	// Current device location
	pin = L.circleMarker(locationState, {
		radius: 6,
		weight: 1,
		color: "black",
		fillColor: "white",
		fillOpacity: 1
	})
	markers.push(pin)
	pin.addTo(map);
});

// Setup a means for the backend to send toasts and popups
socket.on('alert', (data) => {
	let [format, category] = data["type"].split("-")
	if (format == "toast") {
		Swal.fire({
			title: data["message"],
			toast: true,
			position: "bottom",
			showConfirmButton: false,
			timer: 5000,
			icon: category
		})
	} else {
		Swal.fire({
			title: data["title"],
			text: data["message"],
			showConfirmButton: false,
			showCloseButton: true,
			icon: category
		})
	}
});
