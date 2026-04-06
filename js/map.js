const GOOGLE_API_KEY   = (typeof BANDMATE_MAPS_KEY !== 'undefined') ? BANDMATE_MAPS_KEY : '';
const FALLBACK_LOCATION = { lat: 36.1627, lng: -86.7816, name: 'Nashville, TN' };
const VENUE_KEYWORDS    = ['bar','tavern','pub','club','lounge','music','venue','hall','stage','brewery','taproom'];

let map, placesService, infoWindow, searchCircle;
let markers       = [];
let currentCenter = FALLBACK_LOCATION;
let currentRadius = 10;

// Lazy-init autocomplete for the review venue search modal
let reviewVenueAutocomplete = null;

// ─── Map init (Google Maps callback) ─────────────────────────────────────────

function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    zoom: 13,
    center: { lat: FALLBACK_LOCATION.lat, lng: FALLBACK_LOCATION.lng },
    styles: getMapStyle(),
    disableDefaultUI: false,
    zoomControl: true,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    gestureHandling: 'cooperative',
  });

  placesService = new google.maps.places.PlacesService(map);
  infoWindow    = new google.maps.InfoWindow({ maxWidth: 300 });

  // ── Smart search autocomplete ──────────────────────────────────────────────
  // Supports both location searches ("Nashville, TN") and specific venue
  // searches ("The Basement East") in a single input with a live dropdown.
  const searchInput  = document.getElementById('locationInput');
  const autocomplete = new google.maps.places.Autocomplete(searchInput, {
    fields: ['place_id', 'geometry', 'name', 'types', 'formatted_address', 'vicinity']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) {
      // User pressed Enter without selecting — fall back to geocoder
      searchLocation();
      return;
    }

    const loc = {
      lat: place.geometry.location.lat(),
      lng: place.geometry.location.lng()
    };

    // Detect whether the autocomplete result is a specific establishment
    // (bar, club, restaurant, etc.) vs a city / region / postal code
    const establishmentTypes = ['bar','night_club','restaurant','food','point_of_interest','establishment'];
    const isVenue = place.types && place.types.some(t => establishmentTypes.includes(t));

    if (isVenue && place.place_id) {
      // Zoom to venue and open its full review page
      map.setCenter(loc);
      map.setZoom(16);
      openVenuePage(place.place_id, place.name, place.formatted_address || place.vicinity || '');
    } else {
      // Treat as a location — search for venues nearby
      currentCenter = loc;
      map.setCenter(loc);
      map.setZoom(13);
      setStatus('green', `Showing venues near ${place.name}`);
      searchVenuesNearby(currentCenter);
    }
  });

  initAuth();
  locateMe(true); // silent = true, no alert if geolocation denied
}

// ─── Geolocation ─────────────────────────────────────────────────────────────

function locateMe(silent = false) {
  setStatus('amber', 'Locating you...');
  if (!navigator.geolocation) {
    setStatus('amber', 'Geolocation not supported');
    searchVenuesNearby(FALLBACK_LOCATION);
    hideLoading();
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      currentCenter = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      map.setCenter(currentCenter);
      map.setZoom(13);
      reverseGeocode(currentCenter);
      searchVenuesNearby(currentCenter);
    },
    () => {
      if (!silent) setStatus('amber', 'Location denied — using Nashville, TN');
      currentCenter = FALLBACK_LOCATION;
      map.setCenter({ lat: currentCenter.lat, lng: currentCenter.lng });
      setStatus('amber', 'Showing Nashville, TN (default)');
      searchVenuesNearby(currentCenter);
      hideLoading();
    },
    { timeout: 8000 }
  );
}

function reverseGeocode(coords) {
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ location: coords }, (results, status) => {
    if (status !== 'OK' || !results[0]) return;
    const city  = results[0].address_components.find(c =>
      c.types.includes('locality') || c.types.includes('sublocality')
    );
    const state = results[0].address_components.find(c =>
      c.types.includes('administrative_area_level_1')
    );
    const label = city && state
      ? `${city.long_name}, ${state.short_name}`
      : results[0].formatted_address;
    setStatus('green', `Showing venues near ${label}`);
    document.getElementById('locationInput').placeholder = label;
  });
}

// Geocoder fallback — used when user presses Search button or hits Enter
// without selecting an autocomplete suggestion
function searchLocation() {
  const query = document.getElementById('locationInput').value.trim();
  if (!query) return;
  setStatus('amber', `Searching ${query}...`);
  const geocoder = new google.maps.Geocoder();
  geocoder.geocode({ address: query }, (results, status) => {
    if (status === 'OK' && results[0]) {
      currentCenter = {
        lat: results[0].geometry.location.lat(),
        lng: results[0].geometry.location.lng()
      };
      map.setCenter(results[0].geometry.location);
      map.setZoom(13);
      searchVenuesNearby(currentCenter);
    } else {
      setStatus('amber', 'Location not found — try another city');
    }
  });
}

// ─── Venue search ─────────────────────────────────────────────────────────────

function searchVenuesNearby(center) {
  clearMarkers();
  setStatus('amber', 'Searching for venues...');
  document.getElementById('venuesList').innerHTML = `
    <div class="no-results">
      <div class="no-results-icon" style="animation:pulse 1s infinite">🎸</div>
      <div class="no-results-title">Searching...</div>
      <div class="no-results-sub">Finding bars and venues near you.</div>
    </div>`;

  const radiusMeters = currentRadius * 1609.34;

  if (searchCircle) searchCircle.setMap(null);
  searchCircle = new google.maps.Circle({
    map, center, radius: radiusMeters,
    fillColor: '#c94b2a', fillOpacity: 0.04,
    strokeColor: '#c94b2a', strokeOpacity: 0.2, strokeWeight: 1.5,
  });

  placesService.nearbySearch(
    { location: new google.maps.LatLng(center.lat, center.lng), radius: radiusMeters, type: 'bar', keyword: 'live music venue bar' },
    (results, status, pagination) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results?.length) {
        processResults(results);
        if (pagination?.hasNextPage) setTimeout(() => pagination.nextPage(), 800);
        hideLoading();
      } else {
        // Fallback: text search
        placesService.textSearch(
          { location: new google.maps.LatLng(center.lat, center.lng), radius: radiusMeters, query: 'bar music venue live music' },
          (results2, status2) => {
            if (status2 === google.maps.places.PlacesServiceStatus.OK && results2?.length) {
              processResults(results2);
            } else {
              setStatus('amber', 'No venues found — try expanding your radius');
              document.getElementById('venuesList').innerHTML = `
                <div class="no-results">
                  <div class="no-results-icon">🎵</div>
                  <div class="no-results-title">No venues found</div>
                  <div class="no-results-sub">Try expanding your search radius or searching a different city.</div>
                </div>`;
            }
            hideLoading();
          }
        );
      }
    }
  );
}

function processResults(results) {
  const allVenues = results.filter(p => {
    const name  = (p.name || '').toLowerCase();
    const types = p.types || [];
    return types.includes('bar') || types.includes('night_club') ||
           VENUE_KEYWORDS.some(kw => name.includes(kw));
  });
  allVenues.forEach(place => addMarker(place));
  updateVenuesList(allVenues);
  setStatus('green', `${allVenues.length} venues found nearby`);
  document.getElementById('resultsLabel').textContent = `${allVenues.length} Venues Found`;
}

// ─── Markers ──────────────────────────────────────────────────────────────────

function addMarker(place) {
  const rating = place.rating || null;
  const color  = rating >= 4.5 ? '#c94b2a' : rating >= 4.0 ? '#5a7a6a' : rating >= 3.5 ? '#d4a843' : '#8a8278';
  const svg    = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
    <circle cx="18" cy="18" r="10" fill="white" opacity="0.9"/>
    <text x="18" y="22" text-anchor="middle" font-size="11" font-family="Space Mono,monospace" font-weight="700" fill="${color}">${rating ? rating.toFixed(1) : '?'}</text>
  </svg>`;

  const marker = new google.maps.Marker({
    position: { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() },
    map,
    title: place.name,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(36, 44),
      anchor:     new google.maps.Point(18, 44),
    },
    placeId: place.place_id,
  });

  marker.placeData = place;
  marker.addListener('click', () => {
    showInfoWindow(place, marker);
    highlightCard(place.place_id);
  });
  markers.push(marker);
}

function showInfoWindow(place, marker) {
  const rating   = place.rating;
  const stars    = rating ? '★'.repeat(Math.round(rating)) + '☆'.repeat(5 - Math.round(rating)) : 'No rating yet';
  const isOpen   = place.opening_hours?.isOpen?.() ? '<span class="vrc-tag open">Open Now</span>' : '';
  const types    = (place.types || []).filter(t => !['point_of_interest','establishment','food','premise'].includes(t));
  const typeTags = types.slice(0, 3).map(t => `<span class="iw-tag">${t.replace(/_/g, ' ')}</span>`).join('');

  infoWindow.setContent(`
    <div class="info-window">
      <div class="iw-name">${place.name}</div>
      <div class="iw-address">${place.vicinity || ''}</div>
      ${rating
        ? `<div class="iw-rating-row">
             <span class="iw-stars">${stars}</span>
             <span class="iw-rating-num">${rating.toFixed(1)}</span>
             <span class="iw-reviews">${place.user_ratings_total ? `(${place.user_ratings_total} reviews)` : ''}</span>
           </div>`
        : '<div class="iw-reviews" style="margin-bottom:8px">No rating yet</div>'}
      <div class="iw-tags">${typeTags}${isOpen}</div>
      <button class="iw-btn" onclick="openContactModal('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
        Contact This Venue
      </button>
      <button class="iw-btn" style="margin-top:6px;background:var(--ink)" onclick="openVenuePage('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
        Reviews + Full Page
      </button>
    </div>`);
  infoWindow.open(map, marker);
}

// ─── Venue list panel ─────────────────────────────────────────────────────────

function updateVenuesList(venues) {
  if (!venues.length) {
    document.getElementById('venuesList').innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🎵</div>
        <div class="no-results-title">No venues found</div>
        <div class="no-results-sub">Try expanding the radius or searching a different area.</div>
      </div>`;
    return;
  }

  const sorted = [...venues].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  document.getElementById('venuesList').innerHTML = sorted.map(place => {
    const rating = place.rating;
    const stars  = rating ? '★'.repeat(Math.round(rating)) : '—';
    const isOpen = place.opening_hours?.isOpen?.();
    const types  = (place.types || []).filter(t => !['point_of_interest','establishment','food','premise'].includes(t));
    return `
      <div class="venue-result-card" id="card-${place.place_id}" onclick="focusVenue('${place.place_id}')">
        <div class="vrc-header">
          <div class="vrc-name">${place.name}</div>
          ${rating ? `<div class="vrc-rating"><span style="color:var(--gold)">${stars}</span> ${rating.toFixed(1)}</div>` : ''}
        </div>
        <div class="vrc-address">${place.vicinity || ''}</div>
        <div class="vrc-tags">
          ${types.slice(0, 3).map(t => `<span class="vrc-tag">${t.replace(/_/g, ' ')}</span>`).join('')}
          ${isOpen ? '<span class="vrc-tag open">Open Now</span>' : ''}
        </div>
        <button class="vrc-contact-btn"
          onclick="event.stopPropagation(); openContactModal('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
          Contact This Venue
        </button>
        <button class="vrc-contact-btn" style="margin-top:4px;border-color:var(--rust);color:var(--rust)"
          onclick="event.stopPropagation(); openVenuePage('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
          Reviews + Full Page
        </button>
      </div>`;
  }).join('');
}

function focusVenue(placeId) {
  const marker = markers.find(m => m.placeId === placeId);
  if (marker) {
    map.panTo(marker.getPosition());
    map.setZoom(15);
    showInfoWindow(marker.placeData, marker);
    highlightCard(placeId);
  }
}

function highlightCard(placeId) {
  document.querySelectorAll('.venue-result-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`card-${placeId}`);
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function clearMarkers() {
  markers.forEach(m => m.setMap(null));
  markers = [];
  if (infoWindow) infoWindow.close();
}

// ─── Controls ────────────────────────────────────────────────────────────────

function updateSearchRadius() {
  currentRadius = parseInt(document.getElementById('radiusSlider').value);
  if (currentCenter) searchVenuesNearby(currentCenter);
}

function toggleChip(el) {
  document.querySelectorAll('#genreChips .chip').forEach(c => c.classList.remove('active', 'active-rust'));
  el.classList.add('active-rust');
}

function setStatus(type, msg) {
  document.getElementById('statusDot').className  = 'status-dot ' + type;
  document.getElementById('statusText').textContent = msg;
}

function hideLoading() {
  setTimeout(() => document.getElementById('loadingOverlay').classList.add('hidden'), 600);
}

function escapeStr(s) {
  return (s || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, ' ');
}

// ─── Contact modal — defined in auth.js (openContactModal / closeContactModal) ─

// ─── Review venue search modal ────────────────────────────────────────────────
// Opened by the "Leave a Review" nav link. Uses Places Autocomplete filtered
// to establishments only, then hands off to openVenuePage().

function openReviewSearchModal() {
  document.getElementById('reviewSearchModal').classList.add('open');

  // Lazy-init the autocomplete once Maps is loaded
  if (!reviewVenueAutocomplete) {
    reviewVenueAutocomplete = new google.maps.places.Autocomplete(
      document.getElementById('reviewVenueSearch'),
      { types: ['establishment'], fields: ['place_id', 'name', 'formatted_address', 'vicinity'] }
    );
    reviewVenueAutocomplete.addListener('place_changed', () => {
      const place = reviewVenueAutocomplete.getPlace();
      if (!place.place_id) return;
      closeReviewSearchModal();
      openVenuePage(place.place_id, place.name, place.formatted_address || place.vicinity || '');
    });
  }

  setTimeout(() => document.getElementById('reviewVenueSearch').focus(), 100);
  return false;
}

function closeReviewSearchModal() {
  document.getElementById('reviewSearchModal').classList.remove('open');
  document.getElementById('reviewVenueSearch').value = '';
}

// ─── Event listeners ──────────────────────────────────────────────────────────

document.getElementById('contactModal').addEventListener('click', function(e) {
  if (e.target === this) closeContactModal();
});

document.getElementById('reviewSearchModal').addEventListener('click', function(e) {
  if (e.target === this) closeReviewSearchModal();
});

document.getElementById('locationInput').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') searchLocation();
});

// ─── Map style ────────────────────────────────────────────────────────────────

function getMapStyle() {
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
