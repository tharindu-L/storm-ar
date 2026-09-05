# STORM — Environmental & Seismic AR

STORM is an Augmented Reality web app that shows live weather and earthquake data 
in the real world. It works in a mobile browser — no app install needed.

## What it does

STORM has two modes:

- **Weather-Globe** — Point your camera at a Hiro marker to see a live 3D weather 
  scene (sun, clouds, rain, or storm) based on real weather data.
- **Quake-Grid** — Point your camera at the floor to see a 3D grid of recent 
  earthquakes. Each block shows how strong and how deep the earthquake was.

## How it works

- Built with plain **HTML, CSS, and JavaScript** — no build tools needed.
- Uses **A-Frame** and **AR.js** for the marker-based weather scene.
- Uses **WebXR** and **Three.js** for the markerless earthquake grid.
- Gets live data from:
  - **Open-Meteo** (weather)
  - **USGS** (earthquakes)
- Data refreshes every 30 seconds.
- Hosted for free on **GitHub Pages** over HTTPS (required for camera access).

## How to use it

1. Open the live site on your phone using Chrome.
2. Allow camera access when asked.
3. For Weather-Globe: print or show a **Hiro marker** and point your camera at it.
4. For Quake-Grid: point your camera at a flat surface (like a floor or table) 
   and tap to place the earthquake grid.

You can also change the weather location using a URL like this: ?lat=6.9271&lon=79.8612&city=Colombo


## Tech Stack

- HTML / CSS / JavaScript
- A-Frame 1.2.0
- AR.js 3.4.5
- WebXR Device API
- Open-Meteo API
- USGS Earthquake API

## Author

K W T L Padmasiri — IM/2021/008  
Project for INTE 42312 — Virtual and Augmented Reality