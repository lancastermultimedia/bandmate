const GOOGLE_API_KEY   = (typeof BANDMATE_MAPS_KEY !== 'undefined') ? BANDMATE_MAPS_KEY : '';
const FALLBACK_LOCATION = { lat: 36.1627, lng: -86.7816, name: 'Nashville, TN' };
const VENUE_KEYWORDS    = ['bar','tavern','pub','club','lounge','music','venue','hall','stage','brewery','taproom'];

// Venues with dedicated band review pages — placeId → relative URL
const BAND_FAVORITE_PAGES = {
  'ChIJI4sMfoFEQogRu6mxNiuBIHU': 'venues/the-burl-lexington-ky.html',
  'ChIJL89un_NEQogRaR9d0FgvN5I': 'venues/green-lantern-lexington-ky.html',
  'ChIJEaADEBJFQogR1ePUsrbUG6E': 'venues/fishtank-lexington-ky.html',
  'ChIJsbMgk_tEQogRocp77F-dFDo': 'venues/als-bar-lexington-ky.html',
};

let map, placesService, infoWindow, searchCircle;
let markers          = [];
let _svMarkers       = [];    // submitted venue markers (separate from Google)
let currentCenter    = FALLBACK_LOCATION;
let currentRadius    = 10;
let _accumulatedVenues = [];  // accumulates across pagination pages
let _currentCityLabel  = 'Nashville';   // bare city name for nearby bands query
let _nearbyBandsOpen   = false;

// Lazy-init autocomplete for the review venue search modal
let reviewVenueAutocomplete = null;

// ─── Map init (Google Maps callback) ─────────────────────────────────────────

function initMap() {
  if (!document.getElementById('map')) return; // not on the map page
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
    fields: ['place_id', 'geometry', 'location', 'name', 'types', 'formatted_address', 'vicinity']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();

    // Support both old API (place.geometry.location) and new API (place.location)
    const rawLocation = place.geometry?.location ?? place.location;
    if (!rawLocation) {
      if (place.place_id) {
        // Autocomplete returned a place_id but no geometry — fetch full details
        placesService.getDetails(
          { placeId: place.place_id, fields: ['place_id', 'geometry', 'name', 'types', 'formatted_address', 'vicinity'] },
          (result, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && result) {
              handleAutocompletePlace(result);
            } else {
              searchLocation();
            }
          }
        );
      } else {
        // User pressed Enter without selecting — fall back to geocoder
        searchLocation();
      }
      return;
    }

    handleAutocompletePlace(place);
  });

  function handleAutocompletePlace(place) {
    const rawLocation = place.geometry?.location ?? place.location;
    if (!rawLocation) { searchLocation(); return; }

    const loc = {
      lat: typeof rawLocation.lat === 'function' ? rawLocation.lat() : rawLocation.lat,
      lng: typeof rawLocation.lng === 'function' ? rawLocation.lng() : rawLocation.lng
    };

    const geoTypes = ['locality','administrative_area_level_1','administrative_area_level_2',
                      'administrative_area_level_3','country','postal_code',
                      'neighborhood','sublocality','sublocality_level_1','route',
                      'street_address','intersection','natural_feature','airport'];
    const isGeo   = place.types?.some(t => geoTypes.includes(t)) &&
                    !place.types?.includes('establishment');
    const isVenue = !isGeo && place.place_id;

    if (isVenue) {
      map.setCenter(loc);
      map.setZoom(16);
      openVenuePage(place.place_id, place.name, place.formatted_address || place.vicinity || '');
    } else {
      currentCenter = loc;
      map.setCenter(loc);
      map.setZoom(13);
      setStatus('green', `Showing venues near ${place.name}`);
      searchVenuesNearby(currentCenter);
      _currentCityLabel = place.name.split(',')[0].trim();
      loadNearbyBands(_currentCityLabel);
    }
  }

  initAuth();

  // Deep-link: ?place=PLACE_ID opens a specific venue directly
  const deepPlaceId = new URLSearchParams(window.location.search).get('place');
  // Globe search: ?city=Nashville, TN pre-fills the search box
  const deepCity    = new URLSearchParams(window.location.search).get('city');
  // Globe search: ?venue=ID highlights a specific Supabase venue
  const deepVenueId = new URLSearchParams(window.location.search).get('venue');

  if (deepPlaceId) {
    placesService.getDetails({ placeId: deepPlaceId, fields: ['place_id','name','formatted_address','vicinity','geometry'] }, (result, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && result) {
        map.setCenter(result.geometry.location);
        map.setZoom(16);
        openVenuePage(result.place_id, result.name, result.formatted_address || result.vicinity || '');
      } else {
        locateMe(true);
      }
    });
  } else if (deepCity) {
    const inp = document.getElementById('locationInput');
    if (inp) inp.value = deepCity;
    searchLocation();
  } else if (deepVenueId) {
    // Load venue from Supabase, center map on its city, and open its page
    (async () => {
      const { data: v } = await sb.from('venues').select('id, name, city, state, place_id').eq('id', deepVenueId).maybeSingle();
      if (v) {
        const q = [v.city, v.state].filter(Boolean).join(', ');
        const inp = document.getElementById('locationInput');
        if (inp) inp.value = q;
        if (v.place_id) {
          placesService.getDetails({ placeId: v.place_id, fields: ['place_id','name','formatted_address','vicinity','geometry'] }, (result, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && result) {
              map.setCenter(result.geometry.location);
              map.setZoom(16);
              openVenuePage(result.place_id, result.name, result.formatted_address || result.vicinity || '');
            } else {
              searchLocation();
            }
          });
        } else {
          searchLocation();
        }
      } else {
        locateMe(true);
      }
    })();
  } else {
    locateMe(true); // silent = true, no alert if geolocation denied
  }
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
    _currentCityLabel = city ? city.long_name : label.split(',')[0].trim();
    loadNearbyBands(_currentCityLabel);
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
      const cityComp = results[0].address_components.find(c =>
        c.types.includes('locality') || c.types.includes('sublocality')
      );
      _currentCityLabel = cityComp ? cityComp.long_name : query.split(',')[0].trim();
      loadNearbyBands(_currentCityLabel);
    } else {
      setStatus('amber', 'Location not found — try another city');
    }
  });
}

// ─── Venue search ─────────────────────────────────────────────────────────────

async function loadSubmittedVenuesNear(center) {
  clearSubmittedMarkers();
  // Remove any existing submitted venue section in the list
  const existingSection = document.getElementById('svVenueSection');
  if (existingSection) existingSection.remove();

  try {
    const { data: svs } = await sb
      .from('submitted_venues')
      .select('*')
      .not('lat', 'is', null);
    if (!svs?.length) return;

    const radiusDeg = (currentRadius * 1.609) / 111;
    const nearby = svs.filter(sv =>
      Math.abs(sv.lat - center.lat) < radiusDeg &&
      Math.abs(sv.lng - center.lng) < radiusDeg
    );
    if (!nearby.length) return;

    nearby.forEach(sv => addSubmittedVenueMarker(sv));
    _appendSubmittedVenuesSection(nearby);
  } catch (_) {}
}

function _appendSubmittedVenuesSection(svs) {
  const list = document.getElementById('venuesList');
  if (!list) return;

  const section = document.createElement('div');
  section.id = 'svVenueSection';
  section.innerHTML = `
    <div class="vrc-section-label" style="color:var(--sage);border-color:var(--sage)">DIY &amp; House Shows Nearby</div>
    ${svs.map(sv => {
      const typeLabel = sv.venue_type === 'house_show' ? 'House Show' : 'DIY Venue';
      const details = [];
      if (sv.capacity_max) details.push(`Cap. ${sv.capacity_max}`);
      if (sv.has_pa) details.push('PA');
      if (sv.all_ages) details.push('All Ages');
      return `
        <div class="venue-result-card" id="card-${sv.synthetic_place_id}" onclick="openVenuePage('${sv.synthetic_place_id}','${escapeStr(sv.name)}','${escapeStr(sv.city)}')">
          <div class="vrc-header">
            <div class="vrc-name">${sv.name}</div>
          </div>
          <div class="vrc-address">${sv.city}</div>
          <div class="vrc-tags">
            <span class="vrc-tag vrc-tag--diy">${typeLabel}</span>
            ${details.map(d => `<span class="vrc-tag">${d}</span>`).join('')}
          </div>
          <button class="vrc-contact-btn" style="border-color:var(--sage);color:var(--sage);margin-top:4px"
            onclick="event.stopPropagation(); openVenuePage('${sv.synthetic_place_id}','${escapeStr(sv.name)}','${escapeStr(sv.city)}')">
            Reviews + Full Page
          </button>
        </div>`;
    }).join('')}`;
  list.appendChild(section);
}

function addSubmittedVenueMarker(sv) {
  const label = sv.venue_type === 'house_show' ? 'HSV' : 'DIY';
  const color  = '#3a7a8a'; // teal
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
    <circle cx="18" cy="18" r="10" fill="white" opacity="0.9"/>
    <text x="18" y="22" text-anchor="middle" font-size="8" font-family="Space Mono,monospace" font-weight="700" fill="${color}">${label}</text>
  </svg>`;

  const marker = new google.maps.Marker({
    position: { lat: sv.lat, lng: sv.lng },
    map,
    title: sv.name,
    icon: {
      url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
      scaledSize: new google.maps.Size(36, 44),
      anchor:     new google.maps.Point(18, 44),
    },
    placeId: sv.synthetic_place_id,
  });
  marker.placeData = sv;
  marker._isSubmitted = true;

  marker.addListener('click', () => {
    const typeLabel = sv.venue_type === 'house_show' ? 'House Show' : 'DIY Venue';
    infoWindow.setContent(`
      <div class="info-window">
        <div class="iw-name">${escapeHtml(sv.name)}</div>
        <div class="iw-address">${escapeHtml(sv.city)}</div>
        <div class="iw-tags">
          <span class="iw-tag" style="background:var(--sage);color:white;border-color:var(--sage)">${typeLabel}</span>
        </div>
        <button class="iw-btn" style="background:var(--sage)" onclick="openVenuePage('${sv.synthetic_place_id}','${escapeStr(sv.name)}','${escapeStr(sv.city)}')">
          Reviews + Full Page
        </button>
      </div>`);
    infoWindow.open(map, marker);
  });

  _svMarkers.push(marker);
}

function clearSubmittedMarkers() {
  _svMarkers.forEach(m => m.setMap(null));
  _svMarkers = [];
}

function searchVenuesNearby(center) {
  clearMarkers();
  _accumulatedVenues = [];
  setStatus('amber', 'Searching for venues...');
  document.getElementById('venuesList').innerHTML = `
    <div class="no-results">
      <div class="no-results-icon" style="animation:pulse 1s infinite">🎸</div>
      <div class="no-results-title">Searching...</div>
      <div class="no-results-sub">Finding bars and venues near you.</div>
    </div>`;

  const radiusMeters = currentRadius * 1609.34;

  loadSubmittedVenuesNear(center);

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

async function processResults(results) {
  // Don't re-filter by type — nearbySearch/textSearch already filtered at the API
  // level, and Google's type strings have changed across API versions.
  const geoOnlyTypes = ['locality','administrative_area_level_1','administrative_area_level_2',
                        'administrative_area_level_3','country','postal_code'];
  const newVenues = results.filter(p => {
    const types = p.types || [];
    return !types.some(t => geoOnlyTypes.includes(t));
  });
  newVenues.forEach(place => addMarker(place));

  // Accumulate across pagination pages so each new page doesn't wipe the list
  const knownIds = new Set(_accumulatedVenues.map(v => v.place_id));
  newVenues.forEach(v => { if (!knownIds.has(v.place_id)) _accumulatedVenues.push(v); });

  // Fetch Bandmate review genre data for ALL accumulated venues, rank + render
  await enrichAndRenderVenues(_accumulatedVenues);

  setStatus('green', `${_accumulatedVenues.length} venues found nearby`);
  document.getElementById('resultsLabel').textContent = `${_accumulatedVenues.length} Venues Found`;
}

// Fetch genre_played data from reviews, attach to venues, sort, render
async function enrichAndRenderVenues(venues) {
  const placeIds = venues.map(v => v.place_id);

  // Fetch all reviews for these venues (genre_played + place_id only)
  let genreByVenue = {}; // placeId -> [genre, genre, ...]
  try {
    const { data: reviews } = await sb
      .from('reviews')
      .select('google_place_id, genre_played')
      .in('google_place_id', placeIds);

    (reviews || []).forEach(r => {
      if (!r.genre_played) return;
      if (!genreByVenue[r.google_place_id]) genreByVenue[r.google_place_id] = [];
      r.genre_played.split(',').forEach(g => {
        const trimmed = g.toLowerCase().trim();
        if (trimmed) genreByVenue[r.google_place_id].push(trimmed);
      });
    });
  } catch (_) { /* non-fatal — fall back to rating sort */ }

  // Attach genre data to each venue object for use in rendering
  venues.forEach(v => { v._genresPlayed = genreByVenue[v.place_id] || []; });

  updateVenuesList(venues, genreByVenue);
}

// ─── Markers ──────────────────────────────────────────────────────────────────

function addMarker(place) {
  const rating = place.rating || null;
  const color  = rating >= 4.5 ? '#d94535' : rating >= 4.0 ? '#3a7a8a' : rating >= 3.5 ? '#7a8a3a' : '#8a8a7c';
  const svg    = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44">
    <path d="M18 0C8.06 0 0 8.06 0 18c0 13.5 18 26 18 26S36 31.5 36 18C36 8.06 27.94 0 18 0z" fill="${color}"/>
    <circle cx="18" cy="18" r="10" fill="white" opacity="0.9"/>
    <text x="18" y="22" text-anchor="middle" font-size="11" font-family="Space Mono,monospace" font-weight="700" fill="${color}">${rating ? rating.toFixed(1) : '?'}</text>
  </svg>`;

  const rawPos = place.geometry?.location ?? place.location;
  if (!rawPos) return; // no position data — skip marker
  const markerPos = {
    lat: typeof rawPos.lat === 'function' ? rawPos.lat() : rawPos.lat,
    lng: typeof rawPos.lng === 'function' ? rawPos.lng() : rawPos.lng,
  };

  const marker = new google.maps.Marker({
    position: markerPos,
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

  const staticPage = BAND_FAVORITE_PAGES[place.place_id];
  const reviewAction = staticPage
    ? `<a class="iw-btn" href="${staticPage}"
         style="margin-top:6px;background:var(--rust);display:block;text-align:center;text-decoration:none;color:#fff">
         ★ View Full Band Review Page
       </a>`
    : `<button class="iw-btn" style="margin-top:6px;background:var(--ink)" onclick="openVenuePage('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
         Reviews + Full Page
       </button>`;

  const buildContent = (photoHtml) => `
    <div class="info-window">
      ${photoHtml}
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
      ${reviewAction}
    </div>`;

  infoWindow.setContent(buildContent(''));
  infoWindow.open(map, marker);

  // Load photo async — nearbySearch results never carry photos
  if (placesService) {
    placesService.getDetails(
      { placeId: place.place_id, fields: ['photos'] },
      (detail, status) => {
        if (status === 'OK' && detail.photos && detail.photos.length > 0) {
          const url = detail.photos[0].getUrl({ maxWidth: 480, maxHeight: 200 });
          const photoHtml = `<div class="iw-photo-wrap"><img class="iw-photo" src="${url}" alt=""></div>`;
          infoWindow.setContent(buildContent(photoHtml));
        }
      }
    );
  }
}

// ─── Venue list panel ─────────────────────────────────────────────────────────

function updateVenuesList(venues, genreByVenue = {}) {
  if (!venues.length) {
    document.getElementById('venuesList').innerHTML = `
      <div class="no-results">
        <div class="no-results-icon">🎵</div>
        <div class="no-results-title">No venues found</div>
        <div class="no-results-sub">Try expanding the radius or searching a different area.</div>
      </div>`;
    return;
  }

  // Current band's genre for matching (normalised, comma-split for multi-genre)
  const bandGenres = currentBandProfile?.genre
    ? currentBandProfile.genre.toLowerCase().split(',').map(g => g.trim()).filter(Boolean)
    : [];

  // Genre match score: count of how many reviews at this venue match the band's genre(s)
  function genreMatchScore(place) {
    if (!bandGenres.length) return 0;
    const venueGenres = genreByVenue[place.place_id] || [];
    return venueGenres.filter(g => bandGenres.some(bg => g.includes(bg) || bg.includes(g))).length;
  }

  const withScores = venues.map(v => ({ place: v, score: genreMatchScore(v) }));

  // Split into 3 buckets: Band Favorites | Genre matched | Rest
  const favorites    = withScores.filter(({place}) => BAND_FAVORITE_PAGES[place.place_id])
                                 .sort((a,b) => (b.place.rating||0) - (a.place.rating||0));
  const favIds       = new Set(favorites.map(({place}) => place.place_id));
  const genreMatched = withScores.filter(({place, score}) => score > 0 && !favIds.has(place.place_id))
                                 .sort((a,b) => b.score - a.score || (b.place.rating||0) - (a.place.rating||0));
  const rest         = withScores.filter(({place, score}) => score === 0 && !favIds.has(place.place_id))
                                 .sort((a,b) => (b.place.rating||0) - (a.place.rating||0));

  function renderCard({ place, score }, isFav = false) {
    const rating       = place.rating;
    const stars        = rating ? '★'.repeat(Math.round(rating)) : '—';
    const isOpen       = place.opening_hours?.isOpen?.();
    const types        = (place.types || []).filter(t => !['point_of_interest','establishment','food','premise'].includes(t));
    const venueGenres  = [...new Set(genreByVenue[place.place_id] || [])].slice(0, 3);
    const genreTagsHtml = venueGenres.map(g => `<span class="vrc-tag vrc-tag--genre">${g}</span>`).join('');
    const staticPage   = BAND_FAVORITE_PAGES[place.place_id];
    const reviewBtn    = staticPage
      ? `<a class="vrc-contact-btn vrc-fav-page-btn" href="${staticPage}" onclick="event.stopPropagation()">
           ★ View Full Band Review Page
         </a>`
      : `<button class="vrc-contact-btn" style="margin-top:4px;border-color:var(--rust);color:var(--rust)"
           onclick="event.stopPropagation(); openVenuePage('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
           Reviews + Full Page
         </button>`;

    return `
      <div class="venue-result-card${isFav ? ' vrc--fav' : score > 0 ? ' vrc--genre-match' : ''}" id="card-${place.place_id}" onclick="focusVenue('${place.place_id}')">
        ${isFav ? `<div class="vrc-fav-eyebrow">★ Band Reviewed Venue</div>` : ''}
        <div class="vrc-header">
          <div class="vrc-name${isFav ? ' vrc-name--fav' : ''}">${place.name}</div>
          ${rating ? `<div class="vrc-rating"><span style="color:var(--gold)">${stars}</span> ${rating.toFixed(1)}</div>` : ''}
        </div>
        <div class="vrc-address">${place.vicinity || ''}</div>
        <div class="vrc-tags">
          ${types.slice(0, 2).map(t => `<span class="vrc-tag">${t.replace(/_/g, ' ')}</span>`).join('')}
          ${genreTagsHtml}
          ${isOpen ? '<span class="vrc-tag open">Open Now</span>' : ''}
        </div>
        <button class="vrc-contact-btn"
          onclick="event.stopPropagation(); openContactModal('${place.place_id}','${escapeStr(place.name)}','${escapeStr(place.vicinity || '')}')">
          Contact This Venue
        </button>
        ${reviewBtn}
      </div>`;
  }

  // Assemble the three sections
  let html = '';

  if (favorites.length) {
    html += `<div class="vrc-section-label vrc-section-label--fav">Band Reviewed Venues</div>`;
    html += favorites.map(v => renderCard(v, true)).join('');
  }

  if (genreMatched.length) {
    html += `<div class="vrc-section-label">Matched to your genre</div>`;
    html += genreMatched.map(v => renderCard(v)).join('');
  }

  if (rest.length) {
    html += `<div class="vrc-section-label vrc-section-label--all">All venues by rating</div>`;
    html += rest.map(v => renderCard(v)).join('');
  }

  document.getElementById('venuesList').innerHTML = html;
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

// ─── Add Venue Modal ──────────────────────────────────────────────────────────

function openAddVenueModal() {
  const modal = document.getElementById('addVenueModal');
  if (!modal) return;

  if (!currentUser || !currentBandProfile) {
    document.getElementById('avLoginPrompt').style.display = 'block';
    document.getElementById('avFormBody').style.display    = 'none';
  } else {
    document.getElementById('avLoginPrompt').style.display = 'none';
    document.getElementById('avFormBody').style.display    = 'block';
  }
  document.getElementById('avMsg').style.display = 'none';
  modal.classList.add('open');
}
window.openAddVenueModal = openAddVenueModal;

// Exposed so reviews.js can fetch a venue photo without holding its own PlacesService
window.getVenuePhotoUrl = function(placeId, callback) {
  if (!placesService) { callback(null); return; }
  placesService.getDetails(
    { placeId, fields: ['photos'] },
    (place, status) => {
      if (status === 'OK' && place.photos && place.photos.length > 0) {
        callback(place.photos[0].getUrl({ maxWidth: 1200, maxHeight: 440 }));
      } else {
        callback(null);
      }
    }
  );
};

function closeAddVenueModal() {
  document.getElementById('addVenueModal').classList.remove('open');
}
window.closeAddVenueModal = closeAddVenueModal;

async function submitNewVenue() {
  const name    = document.getElementById('avName').value.trim();
  const city    = document.getElementById('avCity').value.trim();
  const privacy = document.getElementById('avPrivacy').checked;
  const avMsg   = document.getElementById('avMsg');
  const type    = document.querySelector('input[name="avType"]:checked')?.value || 'house_show';

  avMsg.style.display = 'none';
  if (!name)    { avMsg.textContent = 'Please enter a venue name.'; avMsg.style.display = 'block'; return; }
  if (!city)    { avMsg.textContent = 'Please enter a city.'; avMsg.style.display = 'block'; return; }
  if (!privacy) { avMsg.textContent = 'Please confirm you have permission to list this space.'; avMsg.style.display = 'block'; return; }

  const btn = document.getElementById('avSubmitBtn');
  btn.textContent = 'Adding...';
  btn.disabled    = true;

  // Geocode the city to get lat/lng for map placement
  let lat = null, lng = null;
  try {
    await new Promise(resolve => {
      new google.maps.Geocoder().geocode({ address: city }, (results, status) => {
        if (status === 'OK' && results[0]) {
          lat = results[0].geometry.location.lat();
          lng = results[0].geometry.location.lng();
        }
        resolve();
      });
    });
  } catch (_) {}

  const syntheticId = 'sv_' + Math.random().toString(36).substring(2, 11) + Date.now().toString(36);

  const capMin = parseInt(document.getElementById('avCapMin').value) || null;
  const capMax = parseInt(document.getElementById('avCapMax').value) || null;
  const instagramRaw = document.getElementById('avInstagram').value.trim();
  const instagram = instagramRaw && !instagramRaw.startsWith('http')
    ? 'https://instagram.com/' + instagramRaw.replace(/^@/, '')
    : instagramRaw || null;

  const payload = {
    synthetic_place_id:   syntheticId,
    name,
    city,
    lat,
    lng,
    venue_type:           type,
    contact_email:        document.getElementById('avEmail').value.trim() || null,
    contact_instagram:    instagram,
    contact_website:      document.getElementById('avWebsite').value.trim() || null,
    capacity_min:         capMin,
    capacity_max:         capMax,
    has_pa:               document.getElementById('avHasPa').checked,
    has_backline:         document.getElementById('avHasBackline').checked,
    overnight_stay:       document.getElementById('avOvernight').checked,
    all_ages:             document.getElementById('avAllAges').checked,
    genre_lean:           document.getElementById('avGenreLean').value.trim() || null,
    door_type:            document.getElementById('avDoorType').value || null,
    description:          document.getElementById('avDescription').value.trim() || null,
    privacy_acknowledged: true,
    submitted_by_band_id: currentBandProfile.id,
  };

  const { error } = await sb.from('submitted_venues').insert(payload);
  if (error) {
    avMsg.textContent = 'Error: ' + error.message;
    avMsg.style.display = 'block';
    btn.textContent = 'Add Venue →';
    btn.disabled = false;
    return;
  }

  closeAddVenueModal();
  showToast('Venue added — thank you!', 'success');

  // Add marker and open its page
  if (lat && lng) addSubmittedVenueMarker({ ...payload, id: 0 });
  openVenuePage(syntheticId, name, city);
}
window.submitNewVenue = submitNewVenue;

// ─── Map style ────────────────────────────────────────────────────────────────

// ─── Nearby Bands ────────────────────────────────────────────────────────────

async function loadNearbyBands(cityName) {
  const header  = document.getElementById('nearbyBandsHeader');
  const panel   = document.getElementById('nearbyBandsPanel');
  const list    = document.getElementById('nearbyBandsList');
  const countEl = document.getElementById('nearbyBandsCount');
  if (!header || !list) return;

  const bareCity = (cityName || '').split(',')[0].trim();
  if (!bareCity) return;

  const { data: bands } = await sb
    .from('bands')
    .select('id, band_name, genre, home_city, profile_photo_url, epk_theme, review_count')
    .ilike('home_city', `${bareCity}%`)
    .not('band_name', 'is', null)
    .order('review_count', { ascending: false })
    .limit(20);

  const filtered = (bands || []).filter(b =>
    b.band_name && (!currentBandProfile || b.id !== currentBandProfile.id)
  );

  if (!filtered.length) {
    header.style.display = 'none';
    panel.style.display  = 'none';
    return;
  }

  countEl.textContent   = filtered.length;
  header.style.display  = 'flex';
  if (_nearbyBandsOpen) panel.style.display = 'block';

  list.innerHTML = filtered.map(b => {
    const initials = (b.band_name || 'B').substring(0, 2).toUpperCase();
    const slug     = (b.band_name || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const epkHref  = b.epk_theme && slug ? `epk.html?band=${slug}` : null;
    const avatarImg = b.profile_photo_url
      ? `<img src="${b.profile_photo_url}" class="nb-avatar nb-avatar-img" alt="${escapeStr(b.band_name)}">`
      : `<div class="nb-avatar nb-avatar-init">${initials}</div>`;
    const avatar = epkHref
      ? `<a href="${epkHref}" target="_blank" class="nb-avatar-link" title="View EPK">${avatarImg}</a>`
      : avatarImg;
    const dmBtn = currentUser
      ? `<a href="community.html?dm=${b.id}" class="nb-dm-btn" title="Message ${escapeStr(b.band_name)}">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
             <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
           </svg>
         </a>`
      : '';
    const rcHtml = b.review_count
      ? `<span class="nb-reviews">★ ${b.review_count}</span>`
      : '';
    return `<div class="nb-card">
      ${avatar}
      <div class="nb-info">
        <div class="nb-name">${escapeStr(b.band_name)}</div>
        <div class="nb-genre">${escapeStr(b.genre || '—')} ${rcHtml}</div>
      </div>
      ${dmBtn}
    </div>`;
  }).join('');
}
window.toggleNearbyBands = function() {
  _nearbyBandsOpen = !_nearbyBandsOpen;
  const panel   = document.getElementById('nearbyBandsPanel');
  const chevron = document.getElementById('nearbyBandsChevron');
  if (panel)   panel.style.display  = _nearbyBandsOpen ? 'block' : 'none';
  if (chevron) chevron.textContent  = _nearbyBandsOpen ? '▴' : '▾';
};

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
