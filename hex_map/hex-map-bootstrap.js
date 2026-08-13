import "./hex-map-website-debug.js";
import "./hex-map-uk-controller.js";
import "./hex-map-cr-controller.js";
import toolbar from "./hex-map-toolbar-controller.js";
import urlState from "./hex-map-url-state.js";
import search from "./hex-map-search.js";
import zoomPan from "./hex-map-zoom-pan.js";

toolbar.mount();
urlState.bootstrap();
search.mount();
zoomPan.mount();
