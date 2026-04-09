// Tour Planner — js/tour.js
// Google Maps async callback: initTourMap

let tourMap;
let tourPlacesService;
let tourWaypoints = [];   // [{ latLng, city, venueResults, selectedVenueIndex }]
let tourMarkers   = [];
let tourPolyline  = null;
let tourHintEl    = null;
let lastShowDates = null; // estimated show dates computed during Step 1

// ── Map init (Google Maps callback) ──────────────────────────────────────────

function initTourMap() {
  tourMap = new google.maps.Map(document.getElementById('tourMap'), {
    zoom: 5,
    center: { lat: 37.8, lng: -96.9 },
    styles: getTourMapStyle(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: 'cooperative',
  });

  tourPlacesService = new google.maps.places.PlacesService(tourMap);
  tourHintEl = document.getElementById('mapHint');

  tourMap.addListener('click', e => {
    addWaypoint(e.latLng);
    if (tourHintEl) tourHintEl.classList.add('hidden');
  });

  // City search autocomplete
  const cityInput = document.getElementById('tourCityInput');
  const cityAC    = new google.maps.places.Autocomplete(cityInput, {
    types: ['(cities)'],
    fields: ['geometry', 'name'],
  });
  cityAC.addListener('place_changed', () => {
    const place = cityAC.getPlace();
    if (!place.geometry) { addStopFromSearch(); return; }
    addWaypoint(place.geometry.location);
    cityInput.value = '';
  });
  cityInput.addEventListener('keydown', e => { if (e.key === 'Enter') addStopFromSearch(); });

  document.getElementById('tourStartDate').addEventListener('change', saveTourState);
  document.getElementById('tourLength').addEventListener('change', saveTourState);

  initAuth();
  sb.auth.onAuthStateChange(() => setTimeout(updateTourGenre, 200));
  setTimeout(updateTourGenre, 1500);

  restoreTourState();

  if (!document.getElementById('tourStartDate').value) {
    document.getElementById('tourStartDate').value = new Date().toISOString().split('T')[0];
  }

  // Click-outside closes venue info modal
  document.getElementById('venueInfoModal').addEventListener('click', function(e) {
    if (e.target === this) closeVenueInfoModal();
  });

  // Click-outside closes contact modal
  document.getElementById('contactModal').addEventListener('click', function(e) {
    if (e.target === this) closeContactModal();
  });

  setTourStatus('idle', 'Type a city or click the map to add a stop');
  document.body.style.visibility = 'visible';
}

// ── localStorage persistence ──────────────────────────────────────────────────

function saveTourState() {
  try {
    const state = {
      waypoints: tourWaypoints.map(wp => ({
        lat:               toLatLng(wp.latLng).lat(),
        lng:               toLatLng(wp.latLng).lng(),
        city:              wp.city,
        searchNote:        wp.searchNote || null,
        selectedVenueIndex: wp.selectedVenueIndex ?? null,
        venues: (wp.venueResults || []).map(v => ({
          name:               v.name,
          vicinity:           v.vicinity || '',
          rating:             v.rating   || null,
          user_ratings_total: v.user_ratings_total || null,
          place_id:           v.place_id  || null,
          lat:                v.lat       || null,
          lng:                v.lng       || null,
        })),
      })),
      startDate:              document.getElementById('tourStartDate').value,
      tourLength:             document.getElementById('tourLength').value,
      showDates:              lastShowDates ? lastShowDates.map(d => d.toISOString()) : null,
      venueSelectionVisible:  document.getElementById('venueSelectionArea').style.display !== 'none',
      itinHtml:               document.getElementById('itinContainer').innerHTML,
      itinCount:              document.getElementById('itinCount').textContent,
      itinVisible:            document.getElementById('itinArea').style.display !== 'none',
    };
    localStorage.setItem('bandmate_tour', JSON.stringify(state));
  } catch (e) {
    console.warn('Could not save tour state:', e);
  }
}

function restoreTourState() {
  try {
    const raw = localStorage.getItem('bandmate_tour');
    if (!raw) return;
    const state = JSON.parse(raw);

    if (state.startDate)  document.getElementById('tourStartDate').value = state.startDate;
    if (state.tourLength) document.getElementById('tourLength').value    = state.tourLength;

    if (state.waypoints?.length) {
      state.waypoints.forEach(wp => {
        const latLng = new google.maps.LatLng(wp.lat, wp.lng);
        const index  = tourWaypoints.length;
        tourWaypoints.push({
          latLng,
          city:               wp.city,
          searchNote:         wp.searchNote || null,
          selectedVenueIndex: wp.selectedVenueIndex ?? null,
          venueResults: (wp.venues || []).map(v => ({
            name:               v.name,
            vicinity:           v.vicinity,
            rating:             v.rating,
            user_ratings_total: v.user_ratings_total || null,
            place_id:           v.place_id  || null,
            lat:                v.lat,
            lng:                v.lng,
          })),
        });
        tourMarkers.push(new google.maps.Marker({
          position: latLng,
          map:      tourMap,
          title:    wp.city || `Stop ${index + 1}`,
          icon:     makeMarkerIcon(index),
        }));
      });

      updatePolyline();
      renderWaypointList();
      fitBoundsToWaypoints();
      if (tourWaypoints.length >= 2) document.getElementById('findVenuesBtn').disabled = false;
      if (tourHintEl) tourHintEl.classList.add('hidden');
      setTourStatus('amber', `${tourWaypoints.length} stops restored — add more or rebuild`);
    }

    if (state.venueSelectionVisible && state.showDates) {
      lastShowDates = state.showDates.map(d => new Date(d));
      renderVenueSelection(lastShowDates);
    }

    // itinHtml is intentionally not restored from localStorage to prevent
    // stored HTML injection. Regenerate the itinerary from the venue selection.
    if (state.itinVisible && state.venueSelectionVisible) {
      document.getElementById('itinArea').style.display        = 'none';
      document.getElementById('downloadItinBtn').style.display = 'none';
    }
  } catch (e) {
    console.warn('Could not restore tour state:', e);
  }
}

// ── Genre pill ────────────────────────────────────────────────────────────────

function updateTourGenre() {
  const area = document.getElementById('tourGenreArea');
  if (!area) return;
  if (currentBandProfile?.genre) {
    document.getElementById('tourGenreText').textContent = currentBandProfile.genre;
    area.style.display = 'block';
  } else {
    area.style.display = 'none';
  }
}

// ── Waypoints ─────────────────────────────────────────────────────────────────

// Normalises any LatLng-like value to a proper google.maps.LatLng
function toLatLng(val) {
  if (typeof val.lat === 'function') return val;
  return new google.maps.LatLng(val.lat, val.lng);
}

function addWaypoint(latLng) {
  const index = tourWaypoints.length;
  tourWaypoints.push({
    latLng:             toLatLng(latLng),
    city:               null,
    venueResults:       [],
    selectedVenueIndex: null,
  });

  tourMarkers.push(new google.maps.Marker({
    position: toLatLng(latLng),
    map:      tourMap,
    title:    `Stop ${index + 1}`,
    icon:     makeMarkerIcon(index),
  }));

  updatePolyline();
  reverseGeocodeWaypoint(index, latLng);
  renderWaypointList();
  fitBoundsToWaypoints();
  resetSteps();
  saveTourState();
  setTourStatus('amber', `${tourWaypoints.length} stop${tourWaypoints.length !== 1 ? 's' : ''} — add more or find venues`);

  if (tourWaypoints.length >= 2) document.getElementById('findVenuesBtn').disabled = false;
}

function reverseGeocodeWaypoint(index, latLng) {
  new google.maps.Geocoder().geocode({ location: toLatLng(latLng) }, (results, status) => {
    if (status !== 'OK' || !results[0]) {
      tourWaypoints[index].city = `Stop ${index + 1}`;
    } else {
      const comps = results[0].address_components;
      const city  = comps.find(c => c.types.includes('locality') || c.types.includes('sublocality'));
      const state = comps.find(c => c.types.includes('administrative_area_level_1'));
      tourWaypoints[index].city = city && state
        ? `${city.long_name}, ${state.short_name}`
        : results[0].formatted_address.split(',').slice(0, 2).join(',').trim();
    }
    renderWaypointList();
    saveTourState();
  });
}

function makeMarkerIcon(index) {
  const colors = ['#c94b2a','#5a7a6a','#d4a843','#4a4540','#8a8278'];
  const color  = colors[index % colors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
    <circle cx="18" cy="18" r="10" fill="white" opacity="0.9"/>
    <text x="18" y="22" text-anchor="middle" font-size="11" font-family="Space Mono,monospace" font-weight="700" fill="${color}">${index + 1}</text>
  </svg>`;
  return {
    url:        'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new google.maps.Size(36, 44),
    anchor:     new google.maps.Point(18, 44),
  };
}

function updatePolyline() {
  if (tourPolyline) tourPolyline.setMap(null);
  if (tourWaypoints.length < 2) { tourPolyline = null; return; }
  tourPolyline = new google.maps.Polyline({
    path:          tourWaypoints.map(w => w.latLng),
    geodesic:      true,
    strokeColor:   '#c94b2a',
    strokeOpacity: 0.65,
    strokeWeight:  2.5,
    icons: [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeWeight: 2 }, offset: '50%' }],
  });
  tourPolyline.setMap(tourMap);
}

function removeWaypoint(index) {
  tourWaypoints.splice(index, 1);
  tourMarkers[index].setMap(null);
  tourMarkers.splice(index, 1);
  tourMarkers.forEach((m, i) => m.setIcon(makeMarkerIcon(i)));
  updatePolyline();
  renderWaypointList();
  resetSteps();
  saveTourState();
  if (tourWaypoints.length < 2) document.getElementById('findVenuesBtn').disabled = true;
  if (tourWaypoints.length === 0) {
    setTourStatus('idle', 'Type a city or click the map to add a stop');
    if (tourHintEl) tourHintEl.classList.remove('hidden');
  } else {
    setTourStatus('amber', `${tourWaypoints.length} stop${tourWaypoints.length !== 1 ? 's' : ''} — add more or find venues`);
  }
}

function clearRoute() {
  tourWaypoints = [];
  tourMarkers.forEach(m => m.setMap(null));
  tourMarkers = [];
  if (tourPolyline) { tourPolyline.setMap(null); tourPolyline = null; }
  document.getElementById('waypointList').innerHTML    = '';
  document.getElementById('findVenuesBtn').disabled    = true;
  document.getElementById('findVenuesBtn').textContent = 'Find Venues Along Route';
  resetSteps();
  lastShowDates = null;
  localStorage.removeItem('bandmate_tour');
  setTourStatus('idle', 'Type a city or click the map to add a stop');
  if (tourHintEl) tourHintEl.classList.remove('hidden');
}

// Hides and empties both Step 1 and Step 2 panels
function resetSteps() {
  document.getElementById('venueSelectionArea').style.display = 'none';
  document.getElementById('itinArea').style.display           = 'none';
  document.getElementById('downloadItinBtn').style.display    = 'none';
  document.getElementById('venueSelectionList').innerHTML     = '';
  document.getElementById('itinContainer').innerHTML          = '';
  document.getElementById('itinCount').textContent            = '';
}

function addStopFromSearch() {
  const input = document.getElementById('tourCityInput');
  const query = input.value.trim();
  if (!query) return;
  new google.maps.Geocoder().geocode({ address: query }, (results, status) => {
    if (status === 'OK' && results[0]) {
      addWaypoint(results[0].geometry.location);
      input.value = '';
      if (tourHintEl) tourHintEl.classList.add('hidden');
    } else {
      showToast('City not found — try a different search', 'error');
    }
  });
}

function fitBoundsToWaypoints() {
  if (!tourWaypoints.length) return;
  if (tourWaypoints.length === 1) {
    tourMap.panTo(tourWaypoints[0].latLng);
    tourMap.setZoom(10);
    return;
  }
  const bounds = new google.maps.LatLngBounds();
  tourWaypoints.forEach(wp => bounds.extend(wp.latLng));
  tourMap.fitBounds(bounds, { top: 80, bottom: 80, left: 60, right: 60 });
}

function renderWaypointList() {
  const colors = ['#c94b2a','#5a7a6a','#d4a843','#4a4540','#8a8278'];
  document.getElementById('waypointList').innerHTML = tourWaypoints.map((wp, i) => `
    <div class="wp-item">
      <div class="wp-num" style="color:${colors[i % colors.length]}">${i + 1}</div>
      <div class="wp-city">${wp.city || 'Locating...'}</div>
      <button class="wp-remove" onclick="removeWaypoint(${i})">✕</button>
    </div>`).join('');
}

// ── Step 1: Find venues + venue selection ─────────────────────────────────────

async function findVenues() {
  if (tourWaypoints.length < 2) return;

  const btn = document.getElementById('findVenuesBtn');
  btn.disabled    = true;
  btn.textContent = 'Searching...';
  resetSteps();

  // Estimate drive times (city centres) to compute provisional show dates
  setTourStatus('amber', 'Estimating drive times...');
  const estimatedDriveTimes = await getDriveTimes();

  // Search venues at every stop in parallel
  setTourStatus('amber', 'Finding venues at each stop...');
  await Promise.all(tourWaypoints.map((_, i) => searchVenuesAtWaypoint(i)));

  lastShowDates = computeShowDates(estimatedDriveTimes);
  renderVenueSelection(lastShowDates);

  setTourStatus('amber', `Choose a venue for each of the ${tourWaypoints.length} stops`);
  btn.textContent = 'Re-Search Venues';
  btn.disabled    = false;

  saveTourState();

  // Auto-advance if all selections already restored from localStorage
  checkAllSelected();
}

function getGenreKeywords() {
  const genre = (currentBandProfile?.genre || '').toLowerCase();
  if (genre.includes('folk') || genre.includes('acoustic')) return 'folk acoustic music bar venue';
  if (genre.includes('punk') || genre.includes('metal'))    return 'punk rock metal bar venue';
  if (genre.includes('jazz') || genre.includes('blues'))    return 'jazz blues bar lounge';
  if (genre.includes('hip'))                                return 'hip hop bar club venue';
  if (genre.includes('country'))                            return 'country bar honky tonk venue';
  if (genre.includes('electronic'))                         return 'electronic club lounge bar';
  return 'live music bar venue music hall';
}

// Wraps nearbySearch in a Promise; resolves with raw results array (never rejects)
function nearbySearchPromise(location, radiusMeters) {
  return new Promise(resolve => {
    tourPlacesService.nearbySearch(
      { location, radius: radiusMeters, type: 'bar', keyword: getGenreKeywords() },
      (results, status) => {
        resolve(status === google.maps.places.PlacesServiceStatus.OK ? results || [] : []);
      }
    );
  });
}

// Filter to venue-type places, sort by rating, map to our schema
function filterAndSortVenues(results) {
  return (results || [])
    .filter(p => {
      const t = p.types || [];
      return t.includes('bar') || t.includes('night_club') || t.includes('music_store');
    })
    .sort((a, b) => (b.rating || 0) - (a.rating || 0))
    .map(p => ({
      name:               p.name,
      vicinity:           p.vicinity || p.formatted_address || '',
      rating:             p.rating   || null,
      user_ratings_total: p.user_ratings_total || null,
      place_id:           p.place_id  || null,
      lat:                p.geometry?.location?.lat() || null,
      lng:                p.geometry?.location?.lng() || null,
    }));
}

// Reverse-geocode a LatLng to "City, ST" string
function geocodeCityName(latLng) {
  return new Promise(resolve => {
    new google.maps.Geocoder().geocode({ location: latLng }, (results, status) => {
      if (status !== 'OK' || !results[0]) { resolve(null); return; }
      const comps = results[0].address_components;
      const city  = comps.find(c => c.types.includes('locality') || c.types.includes('sublocality'));
      const state = comps.find(c => c.types.includes('administrative_area_level_1'));
      resolve(city && state
        ? `${city.long_name}, ${state.short_name}`
        : results[0].formatted_address.split(',').slice(0, 2).join(',').trim());
    });
  });
}

async function searchVenuesAtWaypoint(index) {
  const wp = tourWaypoints[index];
  tourWaypoints[index].searchNote = null; // clear stale note from previous search

  // Progressive radii in metres: 5 → 15 → 25 → 40 → 60 miles
  const RADII_M  = [8047, 24140, 40234, 64374, 96560];
  const RADII_MI = [5,    15,    25,    40,    60];

  let venues       = [];
  let usedRadiusMi = RADII_MI[0];

  for (let r = 0; r < RADII_M.length; r++) {
    usedRadiusMi = RADII_MI[r];
    if (r > 0) {
      // Signal to the status bar that we're widening the net
      setTourStatus('amber', `Stop ${index + 1}: Searching wider area (${usedRadiusMi} mi)…`);
    }
    const raw = await nearbySearchPromise(toLatLng(wp.latLng), RADII_M[r]);
    venues = filterAndSortVenues(raw);
    if (venues.length >= 3) break;
  }

  // ── Nearest-city fallback ────────────────────────────────────────────────────
  // If even 60 mi didn't return 3 venues, try a text search over ~100 miles to
  // find the closest city that has live music, then shift the waypoint there.
  if (venues.length < 3) {
    setTourStatus('amber', `Stop ${index + 1}: Trying nearest city…`);
    const fbRaw = await new Promise(resolve => {
      tourPlacesService.textSearch(
        { query: 'live music bar venue', location: toLatLng(wp.latLng), radius: 160934 },
        (r, s) => resolve(s === google.maps.places.PlacesServiceStatus.OK ? r || [] : [])
      );
    });
    const fbVenues = filterAndSortVenues(fbRaw);

    if (fbVenues.length > venues.length) {
      const firstLoc = fbRaw[0]?.geometry?.location;
      if (firstLoc) {
        const distMi = Math.round(
          haversineKm(
            toLatLng(wp.latLng).lat(), toLatLng(wp.latLng).lng(),
            firstLoc.lat(), firstLoc.lng()
          ) * 0.621371
        );

        if (distMi > 10) {
          // Far enough away to count as "different city" — shift the waypoint
          const originalCity = tourWaypoints[index].city || `Stop ${index + 1}`;
          const fbCityName   = await geocodeCityName(firstLoc);

          tourWaypoints[index].latLng    = firstLoc;
          tourWaypoints[index].city      = fbCityName || originalCity;
          tourWaypoints[index].searchNote =
            `No venues near ${originalCity} — showing venues near ${fbCityName || 'nearby city'}, ${distMi} mi away`;

          // Move map marker to new location
          if (tourMarkers[index]) {
            tourMarkers[index].setPosition(firstLoc);
            updatePolyline();
            fitBoundsToWaypoints();
          }
          renderWaypointList();
        }
        venues = fbVenues;
        usedRadiusMi = distMi;
      }
    }
  }

  // ── Final search note ────────────────────────────────────────────────────────
  if (!tourWaypoints[index].searchNote) {
    if (venues.length === 0) {
      tourWaypoints[index].searchNote = 'No venues found within 60 miles';
    } else if (venues.length < 3) {
      tourWaypoints[index].searchNote =
        `Limited venues in this area — ${venues.length} venue${venues.length !== 1 ? 's' : ''} found within ${usedRadiusMi} miles`;
    } else if (usedRadiusMi > 5) {
      tourWaypoints[index].searchNote = `Venues found within ${usedRadiusMi} miles`;
    } else {
      tourWaypoints[index].searchNote = null;
    }
  }

  tourWaypoints[index].venueResults       = venues.slice(0, 3);
  tourWaypoints[index].selectedVenueIndex = null;
}

// Compute estimated show dates from city-centre drive times
function computeShowDates(driveTimes) {
  const startVal = document.getElementById('tourStartDate').value;
  const date     = startVal ? new Date(startVal + 'T12:00:00') : new Date();
  const dates    = [new Date(date)];
  date.setDate(date.getDate() + 1);

  for (let i = 0; i < driveTimes.length; i++) {
    const driveHours = ((driveTimes[i]?.duration?.value || 0) / 3600);
    if (driveHours > 6)      date.setDate(date.getDate() + 2); // drive + rest day
    else if (driveHours >= 4) date.setDate(date.getDate() + 1); // drive day only
    // < 4 hrs: consecutive day, no extra gap
    dates.push(new Date(date));
    date.setDate(date.getDate() + 1);
  }
  return dates;
}

function renderVenueSelection(showDates) {
  const list = document.getElementById('venueSelectionList');

  list.innerHTML = tourWaypoints.map((wp, wi) => {
    const city    = wp.city || `Stop ${wi + 1}`;
    const dateStr = showDates?.[wi] ? fmtDate(showDates[wi]) : `Night ${wi + 1}`;
    const venues  = wp.venueResults || [];
    const hasSel  = wp.selectedVenueIndex !== null && wp.selectedVenueIndex !== undefined;

    const venuesHtml = venues.length === 0
      ? `<div class="vsc-no-venues">No venues found near this location — drive times will use the city centre</div>`
      : venues.map((v, vi) => {
          const isSel = wp.selectedVenueIndex === vi;
          const stars = v.rating ? '★'.repeat(Math.round(v.rating)) + '☆'.repeat(5 - Math.round(v.rating)) : '';
          return `<div class="vsc-venue${isSel ? ' selected' : ''}" id="vscv-${wi}-${vi}" onclick="selectVenue(${wi},${vi})">
            <div class="vsc-venue-inner">
              <div class="vsc-venue-name">${v.name}</div>
              <div class="vsc-venue-address">${v.vicinity}</div>
              ${v.rating ? `<div class="vsc-venue-rating">${stars} ${v.rating.toFixed(1)}</div>` : ''}
            </div>
            <div class="vsc-venue-actions">
              <button class="vsc-select-btn${isSel ? ' selected' : ''}" onclick="event.stopPropagation();selectVenue(${wi},${vi})">
                ${isSel ? 'Selected ✓' : 'Select →'}
              </button>
              <button class="vsc-info-btn" onclick="event.stopPropagation();openVenueInfoModal(${wi},${vi})">More Info</button>
            </div>
          </div>`;
        }).join('');

    const noteHtml = wp.searchNote
      ? `<div class="vsc-search-note">${wp.searchNote}</div>`
      : '';

    return `<div class="venue-select-card${hasSel ? ' complete' : ''}" id="vsc-${wi}">
      <div class="vsc-header">
        <div class="vsc-city">${city}</div>
        <div class="vsc-date">${dateStr}</div>
      </div>
      ${noteHtml}
      <div class="vsc-venues">${venuesHtml}</div>
    </div>`;
  }).join('');

  document.getElementById('venueSelectionArea').style.display = 'block';
  updateSelectionProgress();
  document.getElementById('venueSelectionArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function selectVenue(wpIndex, venueIndex) {
  tourWaypoints[wpIndex].selectedVenueIndex = venueIndex;

  // Update every venue row in this card
  (tourWaypoints[wpIndex].venueResults || []).forEach((_, vi) => {
    const el = document.getElementById(`vscv-${wpIndex}-${vi}`);
    if (!el) return;
    const isSel = vi === venueIndex;
    el.classList.toggle('selected', isSel);
    const btn = el.querySelector('.vsc-select-btn');
    if (btn) { btn.textContent = isSel ? 'Selected ✓' : 'Select →'; btn.classList.toggle('selected', isSel); }
  });

  const card = document.getElementById(`vsc-${wpIndex}`);
  if (card) card.classList.add('complete');

  updateSelectionProgress();
  saveTourState();
  checkAllSelected();
}

function updateSelectionProgress() {
  const total    = tourWaypoints.length;
  const selected = tourWaypoints.filter(wp =>
    !wp.venueResults?.length ||
    (wp.selectedVenueIndex !== null && wp.selectedVenueIndex !== undefined)
  ).length;
  const el = document.getElementById('selectionProgress');
  if (!el) return;
  el.textContent = `${selected} of ${total} stops selected`;
  el.classList.toggle('complete', selected === total);
}

// Triggers Step 2 automatically once every stop has a venue chosen
function checkAllSelected() {
  if (tourWaypoints.length < 2) return;
  const allDone = tourWaypoints.every(wp =>
    !wp.venueResults?.length ||
    (wp.selectedVenueIndex !== null && wp.selectedVenueIndex !== undefined)
  );
  if (allDone) buildFinalItinerary();
}

// ── Step 2: Final itinerary ───────────────────────────────────────────────────

async function buildFinalItinerary() {
  setTourStatus('amber', 'Calculating precise drive times between venues...');
  const driveTimes = await getDriveTimesBetweenVenues();
  const isPremium  = currentBandProfile ? await checkPremiumAccess(currentBandProfile.id) : false;
  buildItinerary(driveTimes, isPremium);
  setTourStatus('green', `Itinerary ready — ${tourWaypoints.length} stops`);
}

// ── Drive time helpers ────────────────────────────────────────────────────────

// Straight-line distance in km using the Haversine formula
function haversineKm(lat1, lng1, lat2, lng2) {
  const R    = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a    = Math.sin(dLat / 2) ** 2
             + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
             * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Synthetic drive-time element based on straight-line distance.
// Road distance ≈ 1.3× crow-flies; effective speed ≈ 50 mph for long legs.
function fallbackDriveTime(lat1, lng1, lat2, lng2) {
  const km        = haversineKm(lat1, lng1, lat2, lng2);
  const miles     = km * 0.621371;
  const roadMiles = miles * 1.3;
  const hours     = roadMiles / 50;
  const totalMin  = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const timeStr = h > 0
    ? `${h} hr${h !== 1 ? 's' : ''}${m > 0 ? ' ' + m + ' min' : ''}`
    : `${m} min`;
  console.warn('[DM fallback] Using haversine estimate:', timeStr, `(${Math.round(roadMiles)} mi road est.)`);
  return {
    duration: { value: Math.round(hours * 3600), text: `~${timeStr} (est.)` },
    distance: { value: Math.round(roadMiles * 1609.34), text: `~${Math.round(roadMiles)} mi (est.)` },
    status:   'OK',
  };
}

// Calls Distance Matrix for a single origin→destination pair.
// Falls back to haversine estimate if the API fails for any reason.
function singleLegDriveTime(service, origin, destination, label) {
  return new Promise(resolve => {
    const request = {
      origins:      [origin],
      destinations: [destination],
      travelMode:   google.maps.TravelMode.DRIVING,
      unitSystem:   google.maps.UnitSystem.IMPERIAL,
    };
    devLog(`[DM ${label}] Request:`, {
      origin:      `${origin.lat()},${origin.lng()}`,
      destination: `${destination.lat()},${destination.lng()}`,
    });
    service.getDistanceMatrix(request, (response, status) => {
      devLog(`[DM ${label}] Response status: "${status}"`);
      devLog(`[DM ${label}] Full response:`, JSON.stringify(response));
      if (status !== 'OK') {
        console.error(`[DM ${label}] API error "${status}" — falling back to haversine estimate.`);
        console.info('[DM] To fix: enable the Distance Matrix API at console.cloud.google.com and ensure billing is active');
        resolve(fallbackDriveTime(origin.lat(), origin.lng(), destination.lat(), destination.lng()));
        return;
      }
      const element = response.rows[0]?.elements[0];
      devLog(`[DM ${label}] Element:`, element);
      if (element?.status !== 'OK') {
        console.warn(`[DM ${label}] Element status "${element?.status}" — falling back to haversine estimate.`);
        resolve(fallbackDriveTime(origin.lat(), origin.lng(), destination.lat(), destination.lng()));
        return;
      }
      resolve(element);
    });
  });
}

// City-centre drive times — used only for Step 1 date estimation
async function getDriveTimes() {
  if (tourWaypoints.length < 2) return [];
  const service = new google.maps.DistanceMatrixService();
  const results = [];
  for (let i = 0; i < tourWaypoints.length - 1; i++) {
    const origin      = new google.maps.LatLng(tourWaypoints[i].latLng.lat(),   tourWaypoints[i].latLng.lng());
    const destination = new google.maps.LatLng(tourWaypoints[i+1].latLng.lat(), tourWaypoints[i+1].latLng.lng());
    results.push(await singleLegDriveTime(service, origin, destination, `est leg${i}→${i+1}`));
  }
  return results;
}

// Precise venue-to-venue drive times — used to build the final itinerary
async function getDriveTimesBetweenVenues() {
  if (tourWaypoints.length < 2) return [];
  const service = new google.maps.DistanceMatrixService();
  const results = [];
  for (let i = 0; i < tourWaypoints.length - 1; i++) {
    const fromWp    = tourWaypoints[i];
    const toWp      = tourWaypoints[i + 1];
    const fromVenue = fromWp.venueResults?.[fromWp.selectedVenueIndex];
    const toVenue   = toWp.venueResults?.[toWp.selectedVenueIndex];
    const origin      = (fromVenue?.lat && fromVenue?.lng)
      ? new google.maps.LatLng(fromVenue.lat, fromVenue.lng)
      : new google.maps.LatLng(fromWp.latLng.lat(), fromWp.latLng.lng());
    const destination = (toVenue?.lat && toVenue?.lng)
      ? new google.maps.LatLng(toVenue.lat, toVenue.lng)
      : new google.maps.LatLng(toWp.latLng.lat(), toWp.latLng.lng());
    results.push(await singleLegDriveTime(service, origin, destination, `final leg${i}→${i+1}`));
  }
  return results;
}

// ── Itinerary builder ─────────────────────────────────────────────────────────
//
// Spacing rules — pack shows as tightly as drive time allows:
//   < 4 hrs  → consecutive show days (travel morning of show day)
//   4–6 hrs  → one dedicated drive day, then show
//   > 6 hrs  → drive day + rest/buffer day + show
//
// driveInfo is stored on each show day so renderItinerary can display
// the drive from the previous stop beneath the show card.

function buildItinerary(driveTimes, isPremium) {
  const startVal  = document.getElementById('tourStartDate').value;
  const startDate = startVal ? new Date(startVal + 'T12:00:00') : new Date();
  const days      = [];
  const date      = new Date(startDate);

  // Opening night — no drive before it
  days.push({ type: 'show', date: new Date(date), wpIndex: 0, driveInfo: null });
  date.setDate(date.getDate() + 1);

  for (let i = 0; i < driveTimes.length; i++) {
    const leg        = driveTimes[i];
    const driveSecs  = leg?.duration?.value || 0;
    const driveHours = driveSecs / 3600;
    const driveText  = leg?.duration?.text  || null;
    const distText   = leg?.distance?.text  || '';
    const driveInfo  = driveText
      ? `${driveText}${distText ? ' · ' + distText : ''}`
      : null;

    if (!driveText || driveSecs === 0) {
      // Drive time unavailable — schedule next day anyway
      days.push({ type: 'show', date: new Date(date), wpIndex: i + 1, driveInfo: null });
      date.setDate(date.getDate() + 1);

    } else if (driveHours < 4) {
      // Under 4 hrs: show the very next day, travel morning of show
      days.push({ type: 'show', date: new Date(date), wpIndex: i + 1, driveInfo });
      date.setDate(date.getDate() + 1);

    } else if (driveHours <= 6) {
      // 4–6 hrs: one dedicated drive day, then show
      days.push({ type: 'drive', date: new Date(date), driveText, distText, from: i, to: i + 1 });
      date.setDate(date.getDate() + 1);
      days.push({ type: 'show',  date: new Date(date), wpIndex: i + 1, driveInfo });
      date.setDate(date.getDate() + 1);

    } else {
      // Over 6 hrs: drive day + rest/buffer day + show
      days.push({ type: 'drive', date: new Date(date), driveText, distText, from: i, to: i + 1 });
      date.setDate(date.getDate() + 1);
      days.push({ type: 'rest',  date: new Date(date), wpIndex: i + 1 });
      date.setDate(date.getDate() + 1);
      days.push({ type: 'show',  date: new Date(date), wpIndex: i + 1, driveInfo });
      date.setDate(date.getDate() + 1);
    }
  }

  renderItinerary(days, isPremium);
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAY_ABBR   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDate(d) {
  return `${DAY_ABBR[d.getDay()]}, ${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`;
}

function renderItinerary(days, isPremium) {
  let showCount = 0;

  const html = days.map(day => {

    // ── Drive day ─────────────────────────────────────────────────────────────
    if (day.type === 'drive') {
      const fromCity = tourWaypoints[day.from]?.city || `Stop ${day.from + 1}`;
      const toCity   = tourWaypoints[day.to]?.city   || `Stop ${day.to   + 1}`;
      return `<div class="itin-day itin-drive">
        <div class="itin-date">${fmtDate(day.date)}</div>
        <div class="itin-type-label">Drive Day</div>
        <div class="itin-city">${fromCity} → ${toCity}</div>
        ${day.driveText ? `<div class="itin-drive-detail">${day.driveText}${day.distText ? ' · ' + day.distText : ''}</div>` : ''}
      </div>`;
    }

    // ── Rest / arrival day ────────────────────────────────────────────────────
    if (day.type === 'rest') {
      const city = tourWaypoints[day.wpIndex]?.city || `Stop ${day.wpIndex + 1}`;
      return `<div class="itin-day itin-rest">
        <div class="itin-date">${fmtDate(day.date)}</div>
        <div class="itin-type-label">Rest Day</div>
        <div class="itin-city">${city}</div>
        <div class="itin-drive-detail">Arriving after a long drive — rest before the show tomorrow</div>
      </div>`;
    }

    // ── Show day ──────────────────────────────────────────────────────────────
    showCount++;
    const isLocked = !isPremium && showCount > 2;
    const wp       = tourWaypoints[day.wpIndex];
    const city     = wp?.city || `Stop ${day.wpIndex + 1}`;
    const venue    = wp?.venueResults?.[wp?.selectedVenueIndex];

    const travelHtml = day.driveInfo
      ? `<div class="itin-drive-detail" style="margin-bottom:8px">↳ ${day.driveInfo} from previous stop</div>`
      : '';

    let venueHtml = '';
    if (venue) {
      const stars = venue.rating ? '★'.repeat(Math.round(venue.rating)) + '☆'.repeat(5 - Math.round(venue.rating)) : '';
      venueHtml = `<div class="itin-venue">
        <div class="itin-venue-name">${venue.name}</div>
        <div class="itin-venue-address">${venue.vicinity || ''}</div>
        ${venue.rating ? `<div class="itin-venue-rating">${stars} ${venue.rating.toFixed(1)}</div>` : ''}
        <button class="itin-contact-btn" onclick="openContactModal('${venue.place_id || ''}','${escTourStr(venue.name)}','${escTourStr(venue.vicinity || '')}')">
          Contact This Venue →
        </button>
      </div>`;
    } else {
      venueHtml = `<div class="itin-no-venue">No venue selected for this stop</div>`;
    }

    const paywallHtml = isLocked ? `
      <div class="paywall-overlay">
        <div class="paywall-card">
          <div class="paywall-eyebrow">Bandmate Premium</div>
          <div class="paywall-title">Unlock the full route.</div>
          <div class="paywall-sub">See venue picks for all ${tourWaypoints.length} stops and get direct booking contacts.</div>
          <button class="paywall-btn" onclick="showPremiumToast()">Upgrade to Premium →</button>
        </div>
      </div>` : '';

    return `<div class="itin-day itin-show" ${isLocked ? 'style="position:relative;overflow:hidden;"' : ''}>
      <div class="itin-date">${fmtDate(day.date)}</div>
      <div class="itin-type-label">Show Day</div>
      <div class="itin-city">${city}</div>
      ${travelHtml}
      <div class="${isLocked ? 'itin-venue blurred' : ''}">${venueHtml}</div>
      ${paywallHtml}
    </div>`;
  }).join('');

  const showDays  = days.filter(d => d.type === 'show').length;
  const driveDays = days.filter(d => d.type === 'drive').length;
  const restDays  = days.filter(d => d.type === 'rest').length;
  const parts     = [`${showDays} show${showDays !== 1 ? 's' : ''}`];
  if (driveDays) parts.push(`${driveDays} drive day${driveDays !== 1 ? 's' : ''}`);
  if (restDays)  parts.push(`${restDays} rest day${restDays !== 1 ? 's' : ''}`);

  document.getElementById('itinContainer').innerHTML          = html;
  document.getElementById('itinCount').textContent            = parts.join(' · ');
  document.getElementById('itinArea').style.display           = 'block';
  document.getElementById('downloadItinBtn').style.display    = 'block';

  saveTourState();
  document.getElementById('itinArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Utilities ─────────────────────────────────────────────────────────────────


function escTourStr(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}

// ── Venue info modal ─────────────────────────────────────────────────────────

async function openVenueInfoModal(wpIndex, venueIndex) {
  const venue = tourWaypoints[wpIndex]?.venueResults?.[venueIndex];
  if (!venue) return;

  const modal = document.getElementById('venueInfoModal');
  const content = document.getElementById('venueInfoContent');

  // Show modal immediately with loading state
  content.innerHTML = `<div class="vim-loading">Loading reviews...</div>`;
  modal.classList.add('open');

  // Store context for the Select button
  modal.dataset.wpIndex    = wpIndex;
  modal.dataset.venueIndex = venueIndex;

  // Fetch Bandmate community reviews from Supabase
  let bmReviews = [];
  if (venue.place_id) {
    const { data } = await sb
      .from('reviews')
      .select('overall_rating, sound_rating, comms_rating, merch_rating, parking_rating, review_text, created_at, bands(band_name)')
      .eq('google_place_id', venue.place_id)
      .order('created_at', { ascending: false })
      .limit(10);
    bmReviews = data || [];
  }

  // Compute averages across all fetched reviews
  const avg = key => bmReviews.length
    ? (bmReviews.reduce((s, r) => s + (r[key] || 0), 0) / bmReviews.length).toFixed(1)
    : null;

  // Google rating
  const gStars = venue.rating
    ? '★'.repeat(Math.round(venue.rating)) + '☆'.repeat(5 - Math.round(venue.rating))
    : '';

  // Score breakdown block
  const scoresHtml = bmReviews.length ? `
    <div class="vim-scores">
      <div class="vim-score"><div class="vim-score-label">Sound</div><div class="vim-score-val">${avg('sound_rating')}</div></div>
      <div class="vim-score"><div class="vim-score-label">Communication</div><div class="vim-score-val">${avg('comms_rating')}</div></div>
      <div class="vim-score"><div class="vim-score-label">Merch</div><div class="vim-score-val">${avg('merch_rating')}</div></div>
      <div class="vim-score"><div class="vim-score-label">Parking</div><div class="vim-score-val">${avg('parking_rating')}</div></div>
    </div>` : '';

  // Two most recent written reviews
  const recentHtml = bmReviews.slice(0, 2).map(r => {
    const rStars = '★'.repeat(r.overall_rating || 0) + '☆'.repeat(5 - (r.overall_rating || 0));
    const band   = escapeHtml(r.bands?.band_name || 'Anonymous Band');
    return `<div class="vim-review">
      <div class="vim-review-header">
        <span class="vim-review-band">${band}</span>
        <span class="vim-review-stars">${rStars}</span>
      </div>
      <p class="vim-review-text">${escapeHtml(r.review_text || '')}</p>
    </div>`;
  }).join('');

  const communityHtml = bmReviews.length ? `
    <div class="vim-section-label">Bandmate Community · ${bmReviews.length} review${bmReviews.length !== 1 ? 's' : ''}</div>
    ${scoresHtml}
    ${recentHtml}
  ` : `<div class="vim-no-reviews">No Bandmate reviews yet — be the first to review this venue.</div>`;

  const isSel = tourWaypoints[wpIndex]?.selectedVenueIndex === venueIndex;

  content.innerHTML = `
    <div class="vim-eyebrow">Venue Info</div>
    <div class="vim-name">${escapeHtml(venue.name)}</div>
    <div class="vim-address">${escapeHtml(venue.vicinity || '')}</div>
    ${venue.rating ? `<div class="vim-google-rating">${gStars} ${venue.rating.toFixed(1)}${venue.user_ratings_total ? ` &nbsp;·&nbsp; ${venue.user_ratings_total.toLocaleString()} Google reviews` : ''}</div>` : ''}
    <div class="vim-divider"></div>
    ${communityHtml}
    <button class="vim-select-btn${isSel ? ' selected' : ''}" onclick="selectVenue(${wpIndex},${venueIndex});closeVenueInfoModal()">
      ${isSel ? 'Selected ✓' : 'Select This Venue →'}
    </button>
  `;
}

function closeVenueInfoModal() {
  document.getElementById('venueInfoModal').classList.remove('open');
}

function downloadItinerary() { window.print(); }

function showPremiumToast() {
  showToast('Premium coming soon — stay tuned for launch pricing.');
}

function setTourStatus(type, msg) {
  const dot = document.getElementById('tourStatusDot');
  const txt = document.getElementById('tourStatusText');
  const bg  = type === 'green' ? 'var(--sage)' : type === 'amber' ? 'var(--gold)' : 'var(--muted)';
  if (dot) dot.style.background = bg;
  if (txt) txt.textContent = msg;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CURATED TOURS
// ═══════════════════════════════════════════════════════════════════════════════

const CURATED_TOURS = [
  {
    id:      'americana-highway',
    name:    'The Americana Highway',
    tagline: 'Nashville to Austin through the heart of it all',
    color:   '#c94b2a',
    gradient:'linear-gradient(135deg, #c94b2a 0%, #8b3520 50%, #5c2415 100%)',
    cities:  ['Nashville, TN', 'Memphis, TN', 'Oxford, MS', 'Jackson, MS', 'New Orleans, LA', 'Baton Rouge, LA', 'Houston, TX', 'Austin, TX'],
    stats:   { cities: 8, days: '10–12 days', genres: 'Americana / Country / Blues', miles: '~1,100 mi' },
    description: 'Follow the spine of American music from Nashville through the Delta and into Texas. This route hits some of the most music-rich cities in the country, passing through the birthplace of blues, soul, and country. Venues along this route tend to draw passionate local crowds and have deep respect for original music. Best run in spring or fall to avoid summer heat.',
    expect: [
      'Play weekday shows in smaller markets (Memphis, Oxford) and Thursday–Saturday in bigger cities (Nashville, Houston, Austin)',
      'Delta blues venues in Mississippi often operate on door deals — get payout terms in writing before load-in',
      'New Orleans requires extra lead time for booking; the scene is relationship-driven and social',
      'Budget extra for parking and gear handling in Houston; Austin has excellent load-in infrastructure at most venues',
    ],
    venues: ['The Basement (Nashville)', 'Hi-Tone Café (Memphis)', "Tipitina's (New Orleans)"],
  },
  {
    id:      'college-circuit',
    name:    'The College Circuit',
    tagline: 'Eight college towns, eight ready-made audiences',
    color:   '#5a7a6a',
    gradient:'linear-gradient(135deg, #5a7a6a 0%, #3d5c4e 50%, #253d34 100%)',
    cities:  ['Columbus, OH', 'Athens, OH', 'Morgantown, WV', 'Charlottesville, VA', 'Chapel Hill, NC', 'Columbia, SC', 'Athens, GA', 'Tallahassee, FL'],
    stats:   { cities: 8, days: '9–11 days', genres: 'Indie / Alt / Rock / Folk', miles: '~900 mi' },
    description: 'College towns are the secret weapon of the independent touring band. Built-in young audiences, venues that love original music, affordable cities to stay in, and promoters who are genuinely excited about new acts. This southeastern college circuit hits some of the most underrated music scenes in the country. Athens GA alone is worth the whole trip.',
    expect: [
      'Book 6–8 weeks out — college venue calendars fill fast, especially near exam periods (avoid finals weeks)',
      'Offer student pricing at the door to maximize turnout; college crowds are deal-conscious',
      'Athens GA has a walkable venue district — plan for two nights to properly experience the scene',
      'Connect with campus radio stations and student promoters 2–3 months ahead for social media support',
    ],
    venues: ['The Newport Music Hall (Columbus)', 'The Jefferson (Charlottesville)', '40 Watt Club (Athens GA)'],
  },
  {
    id:      'diy-northeast',
    name:    'The DIY Northeast',
    tagline: 'Boston to Philly through the original indie underground',
    color:   '#2a3a5a',
    gradient:'linear-gradient(135deg, #2a3a5a 0%, #1a2540 50%, #0e1628 100%)',
    cities:  ['Boston, MA', 'Providence, RI', 'New Haven, CT', 'New York, NY', 'Brooklyn, NY', 'Philadelphia, PA'],
    stats:   { cities: 6, days: '7–8 days', genres: 'Punk / Indie / Experimental / Folk', miles: '~350 mi' },
    description: 'The most densely packed music corridor in America. Short drives between major cities mean you can play every night without exhausting your band. The northeast DIY scene has been incubating groundbreaking music for decades and the venues here have seen everything — which means they appreciate something genuinely original. Budget for tolls and parking in New York.',
    expect: [
      'E-ZPass is essential — budget $30–50 in tolls per day through Connecticut and New Jersey',
      'NYC parking is brutal; use load zones strategically and have a dedicated driver the whole time',
      'Providence and New Haven punch well above their weight — dedicated scenes that reward originality',
      'Book 2–3 months ahead in NYC; Providence and New Haven venues are far more accessible on short notice',
    ],
    venues: ['The Middle East (Boston)', 'Bowery Electric (New York)', 'Underground Arts (Philadelphia)'],
  },
  {
    id:      'pacific-coast',
    name:    'The Pacific Coast Run',
    tagline: 'Seattle to San Diego with the Pacific always on your left',
    color:   '#2a5a7a',
    gradient:'linear-gradient(135deg, #2a5a7a 0%, #1a3d5c 50%, #0e2438 100%)',
    cities:  ['Seattle, WA', 'Portland, OR', 'Eugene, OR', 'San Francisco, CA', 'Santa Cruz, CA', 'Los Angeles, CA', 'San Diego, CA'],
    stats:   { cities: 7, days: '9–11 days', genres: 'Indie / Folk / Alternative / Electronic', miles: '~1,300 mi' },
    description: 'One of the most beautiful drives in North America doubles as one of the best music corridors on the west coast. Each city has its own distinct scene and personality — Seattle and Portland for the moody indie crowd, San Francisco for the experimental and folk scene, LA for industry connections, San Diego to close it out with a beach town crowd. Camp in state parks to keep costs down.',
    expect: [
      'The I-5 corridor makes this easy driving; budget 3–4 hours Seattle to Portland, 10–12 hours Portland to SF',
      'San Francisco requires advance booking; the Mission and SoMa venue scenes are competitive and slow to respond',
      'LA shows often start late and run long; add 1–2 buffer days for industry meetings and recovery',
      'State parks between cities are cheap and beautiful — Big Sur and the Redwoods are unmissable on days off',
    ],
    venues: ['The Crocodile (Seattle)', 'Doug Fir Lounge (Portland)', 'The Fillmore (San Francisco)'],
  },
  {
    id:      'southern-gothic',
    name:    'The Southern Gothic',
    tagline: 'New Orleans to Asheville through the strange and beautiful south',
    color:   '#3a2a4a',
    gradient:'linear-gradient(135deg, #3a2a4a 0%, #261a34 50%, #140e1e 100%)',
    cities:  ['New Orleans, LA', 'Mobile, AL', 'Birmingham, AL', 'Atlanta, GA', 'Greenville, SC', 'Charlotte, NC', 'Asheville, NC'],
    stats:   { cities: 7, days: '8–10 days', genres: 'Jazz / Blues / Soul / Folk / Americana', miles: '~900 mi' },
    description: 'The American south is one of the most misunderstood touring regions. Skip the stereotypes and you find some of the warmest crowds, most historic venues, and most soulful music scenes anywhere. This route ends in Asheville — one of the most vibrant small music cities in the country. The drive through the Blue Ridge mountains on the final leg is worth the entire trip.',
    expect: [
      'The deep south moves on its own schedule; add buffer days and don\'t over-pack the itinerary',
      'Birmingham has a quietly excellent original music scene that is seriously and consistently underrated',
      'Asheville is one of the best music cities in America per capita — save your energy for the last night',
      'New Orleans load-in logistics can be complex in the French Quarter; hire a local stage hand if budget allows',
    ],
    venues: ["Tipitina's (New Orleans)", 'WorkPlay (Birmingham)', 'The Orange Peel (Asheville)'],
  },
  {
    id:      'underground-circuit',
    name:    'The Underground Circuit',
    tagline: 'From the birthplace of house and techno to the new electronic frontier',
    color:   '#7b2d8b',
    gradient:'linear-gradient(135deg, #1a1a2e 0%, #16213e 40%, #0f3460 70%, #1a1a2e 100%)',
    cities:  ['Chicago, IL', 'Milwaukee, WI', 'Detroit, MI', 'Cleveland, OH', 'Pittsburgh, PA', 'Baltimore, MD', 'Washington, DC'],
    stats:   { cities: 7, days: '8–10 days', genres: 'House / Techno / Electronic / EDM / Experimental', miles: '~900 mi' },
    description: "This route traces the roots of modern electronic music back to where it all began. Chicago's South Side gave birth to house music in the early 1980s in venues like the Warehouse — the literal origin of the word. An hour and a half north Detroit was simultaneously developing techno in basement clubs and loft parties. These cities didn't just influence electronic music, they invented it. Today both cities still have thriving underground club scenes with deep respect for the music's origins. Milwaukee punches above its weight with a fierce DIY electronic scene. The route east takes you through Cleveland and Pittsburgh — both cities with growing underground followings — before finishing in the Baltimore and DC corridor which has one of the most active electronic and experimental scenes on the east coast. This route is best run Thursday through Sunday nights when the electronic venues are at full energy. Expect late nights, passionate crowds, and venues that care deeply about sound system quality.",
    expect: [
      'Late show times — most electronic venues don\'t peak until midnight or later, plan accordingly',
      'Sound system matters — venues on this route are known for quality audio, bring your best setup',
      'Chicago and Detroit stops are historically significant — mention this in your booking pitch, it resonates',
      'The DC and Baltimore scene skews experimental — adventurous sets do well here',
    ],
    venues: ['Smartbar (Chicago)', 'Marble Bar (Detroit)', 'U Street Music Hall (Washington DC)'],
    venuesByCity: {
      'Chicago, IL':      ['Smartbar', 'The Empty Bottle', 'Schubas Tavern'],
      'Detroit, MI':      ['Marble Bar', 'TV Lounge', 'Tangent Gallery'],
      'Washington, DC':   ['U Street Music Hall', 'Black Cat', 'Songbyrd'],
    },
  },
];

// ── Open / close curated tours list modal ────────────────────────────────────

function openCuratedToursModal() {
  const overlay = document.getElementById('curatedToursModal');
  if (!overlay) return;
  renderCuratedToursGrid();
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeCuratedToursModal() {
  const overlay = document.getElementById('curatedToursModal');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

function renderCuratedToursGrid() {
  const grid = document.getElementById('curatedToursGrid');
  if (!grid) return;
  grid.innerHTML = CURATED_TOURS.map(tour => `
    <div class="ct-card" onclick="openTourDetail('${tour.id}')">
      <div class="ct-card-header" style="background:${tour.gradient}">
        <div class="ct-card-eyebrow">Curated Route</div>
        <div class="ct-card-name">${tour.name}</div>
        <div class="ct-card-tagline">${tour.tagline}</div>
      </div>
      <div class="ct-card-body">
        <div class="ct-card-stats">
          <div class="ct-card-stat"><span class="ct-stat-num">${tour.stats.cities}</span><span class="ct-stat-label">Cities</span></div>
          <div class="ct-card-stat"><span class="ct-stat-num">${tour.stats.days.split(' ')[0]}</span><span class="ct-stat-label">Days</span></div>
          <div class="ct-card-stat ct-stat-wide"><span class="ct-stat-label">${tour.stats.genres}</span></div>
          <div class="ct-card-stat"><span class="ct-stat-num" style="font-size:0.8rem">${tour.stats.miles}</span><span class="ct-stat-label">Est. Miles</span></div>
        </div>
        <button class="ct-card-btn" style="border-color:${tour.color};color:${tour.color}" onclick="event.stopPropagation();openTourDetail('${tour.id}')">View This Route →</button>
      </div>
    </div>
  `).join('');
}

// ── Open / close individual tour detail overlay ───────────────────────────────

function openTourDetail(tourId) {
  const tour = CURATED_TOURS.find(t => t.id === tourId);
  if (!tour) return;

  const overlay = document.getElementById('tourDetailOverlay');
  const content = document.getElementById('tourDetailContent');
  if (!overlay || !content) return;

  const citiesHtml = tour.cities.map((city, i) => `
    <div class="ct-route-stop">
      <div class="ct-route-dot" style="background:${tour.color}"></div>
      <div class="ct-route-city">${city}</div>
      ${i < tour.cities.length - 1 ? '<div class="ct-route-line"></div>' : ''}
    </div>
  `).join('');

  const expectHtml = tour.expect.map(tip => `
    <div class="ct-expect-item">
      <div class="ct-expect-dot" style="background:${tour.color}"></div>
      <div class="ct-expect-text">${tip}</div>
    </div>
  `).join('');

  const venuesHtml = tour.venues.map(v => `
    <div class="ct-venue-item">
      <div class="ct-venue-pin" style="color:${tour.color}">📍</div>
      <div class="ct-venue-name">${v}</div>
    </div>
  `).join('');

  content.innerHTML = `
    <div class="ct-detail-hero" style="background:${tour.gradient}">
      <div class="ct-detail-hero-inner">
        <div class="ct-detail-eyebrow">Curated Tour Route</div>
        <h1 class="ct-detail-name">${tour.name}</h1>
        <div class="ct-detail-tagline">${tour.tagline}</div>
        <div class="ct-detail-stats-row">
          <div class="ct-detail-stat"><div class="ct-detail-stat-num">${tour.stats.cities}</div><div class="ct-detail-stat-label">Cities</div></div>
          <div class="ct-detail-stat"><div class="ct-detail-stat-num">${tour.stats.days}</div><div class="ct-detail-stat-label">Estimated</div></div>
          <div class="ct-detail-stat"><div class="ct-detail-stat-num">${tour.stats.miles}</div><div class="ct-detail-stat-label">Total Miles</div></div>
        </div>
      </div>
    </div>

    <div class="ct-detail-body">

      <div class="ct-detail-section">
        <div class="ct-detail-section-label">The Route</div>
        <div class="ct-route-viz">${citiesHtml}</div>
      </div>

      <div class="ct-detail-section">
        <div class="ct-detail-section-label">About This Route</div>
        <p class="ct-detail-desc">${tour.description}</p>
      </div>

      <div class="ct-detail-section">
        <div class="ct-detail-section-label">Genres</div>
        <div class="ct-genres-wrap">
          ${tour.stats.genres.split(' / ').map(g => `<span class="ct-genre-pill" style="border-color:${tour.color};color:${tour.color}">${g}</span>`).join('')}
        </div>
      </div>

      <div class="ct-detail-section">
        <div class="ct-detail-section-label">What to Expect</div>
        <div class="ct-expect-list">${expectHtml}</div>
      </div>

      <div class="ct-detail-section">
        <div class="ct-detail-section-label">Great Venues on This Route</div>
        <div class="ct-detail-venues-note">A few well-known spots to anchor your booking conversations. More data coming as the Bandmate community grows.</div>
        <div class="ct-venues-list">${venuesHtml}</div>
      </div>

      <div class="ct-detail-cta">
        <div class="ct-detail-cta-title">Ready to plan this tour?</div>
        <div class="ct-detail-cta-sub">Load all ${tour.cities.length} cities into the Tour Planner with one click, then find venues and build your itinerary.</div>
        <button class="ct-load-btn" style="background:${tour.color}" onclick="loadCuratedRoute('${tour.id}')">
          Load This Route Into Tour Planner →
        </button>
      </div>

    </div>
  `;

  overlay.classList.add('open');
}

function closeTourDetail() {
  const overlay = document.getElementById('tourDetailOverlay');
  if (overlay) overlay.classList.remove('open');
}

// ── Load a curated route into the tour planner ───────────────────────────────

async function loadCuratedRoute(tourId) {
  const tour = CURATED_TOURS.find(t => t.id === tourId);
  if (!tour) return;

  closeTourDetail();
  closeCuratedToursModal();
  clearRoute();

  setTourStatus('amber', `Loading ${tour.cities.length} cities…`);
  showToast(`Loading route: ${tour.name}…`);

  const geocoder = new google.maps.Geocoder();

  for (const cityName of tour.cities) {
    await new Promise(resolve => {
      geocoder.geocode({ address: cityName }, (results, status) => {
        if (status === 'OK' && results[0]) {
          const latLng = results[0].geometry.location;
          const idx = tourWaypoints.length;
          tourWaypoints.push({
            latLng:             toLatLng(latLng),
            city:               cityName,
            venueResults:       [],
            selectedVenueIndex: null,
          });
          tourMarkers.push(new google.maps.Marker({
            position: toLatLng(latLng),
            map:      tourMap,
            title:    cityName,
            icon:     makeMarkerIcon(idx),
          }));
        }
        resolve();
      });
    });
  }

  updatePolyline();
  renderWaypointList();
  fitBoundsToWaypoints();
  saveTourState();

  if (tourWaypoints.length >= 2) {
    document.getElementById('findVenuesBtn').disabled = false;
    if (tourHintEl) tourHintEl.classList.add('hidden');
  }

  setTourStatus('green', `${tourWaypoints.length} stops loaded — find venues to continue`);
  showToast(`"${tour.name}" loaded — ${tourWaypoints.length} cities`, 'success');
}

// ── Map style ─────────────────────────────────────────────────────────────────

function getTourMapStyle() {
  return [
    { elementType: 'geometry',            stylers: [{ color: '#ede9e0' }] },
    { elementType: 'labels.text.fill',    stylers: [{ color: '#4a4540' }] },
    { elementType: 'labels.text.stroke',  stylers: [{ color: '#f5f0e8' }] },
    { featureType: 'road',            elementType: 'geometry',        stylers: [{ color: '#ffffff' }] },
    { featureType: 'road',            elementType: 'geometry.stroke', stylers: [{ color: '#ddd8cc' }] },
    { featureType: 'road.highway',    elementType: 'geometry',        stylers: [{ color: '#f0e9d6' }] },
    { featureType: 'water',           elementType: 'geometry',        stylers: [{ color: '#c8d8e8' }] },
    { featureType: 'poi.park',        elementType: 'geometry',        stylers: [{ color: '#d8e8d0' }] },
    { featureType: 'poi',             elementType: 'labels',          stylers: [{ visibility: 'off' }] },
    { featureType: 'transit',                                          stylers: [{ visibility: 'off' }] },
  ];
}
