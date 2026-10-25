// React wrapper around SurveyMap. Leaflet owns the map and its popups; React
// renders popup content into Leaflet's popup elements through portals.

import L from 'leaflet';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../hooks/useAuth';
import { SurveyMap } from '../map';
import type { Pin } from '../pinsApi';
import { useNotice } from './Notices';
import { PinPopup } from './PinPopup';

interface MapViewProps {
  /** Bump to reload pins, e.g. after a pin is added, edited or deleted. */
  reloadKey: number;
  onAddPin: (latlng: L.LatLng) => void;
  onEditPin: (pin: Pin) => void;
  onDeletePin: (pin: Pin) => void;
}

type PopupTarget = { kind: 'pin'; pin: Pin } | { kind: 'new'; latlng: L.LatLng };

interface OpenPopup {
  popup: L.Popup;
  element: HTMLElement;
  target: PopupTarget;
}

export function MapView({ reloadKey, onAddPin, onEditPin, onDeletePin }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<SurveyMap | null>(null);
  const [openPopup, setOpenPopup] = useState<OpenPopup | null>(null);
  const user = useAuth();
  const notice = useNotice();

  // SurveyMap is created once, so it calls through this ref to get the latest props.
  const handlers = useRef({ onAddPin, onEditPin, onDeletePin, notice });
  handlers.current = { onAddPin, onEditPin, onDeletePin, notice };
  const lastLoadError = useRef<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const surveyMap = new SurveyMap(container, {
      // A click on the map offers to add a pin there, rather than opening the
      // form straight away, so stray clicks (e.g. closing a popup) don't start a pin.
      onMapClick: (latlng) => {
        const element = document.createElement('div');
        const popup = L.popup().setLatLng(latlng).setContent(element).openOn(surveyMap.map);
        setOpenPopup({ popup, element, target: { kind: 'new', latlng } });
      },
      // Every pan and zoom reloads, so show a given load error once rather than on every move.
      onLoadError: (error) => {
        if (error.message === lastLoadError.current) return;
        lastLoadError.current = error.message;
        handlers.current.notice(`Couldn't load pins: ${error.message}`, 'error');
      },
    });

    surveyMap.map.on('popupopen', (event: L.PopupEvent) => {
      // Pin popups each hold a fixed empty element; render the pin's latest data into it.
      const pin = surveyMap.pinForPopup(event.popup);
      const element = event.popup.getContent();
      if (pin && element instanceof HTMLElement) {
        setOpenPopup({ popup: event.popup, element, target: { kind: 'pin', pin } });
      }
    });
    surveyMap.map.on('popupclose', (event: L.PopupEvent) => {
      setOpenPopup((current) => (current?.popup === event.popup ? null : current));
    });

    mapRef.current = surveyMap;
    return () => {
      surveyMap.destroy();
      mapRef.current = null;
      setOpenPopup(null);
    };
  }, []);

  // Reload when asked to, and when the user changes (RLS returns different pins).
  // Skips the first run because SurveyMap loads on creation.
  const firstLoad = useRef(true);
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    // A sign-in change or deliberate reload may fix (or change) the error, so show it again if it recurs.
    lastLoadError.current = null;
    void mapRef.current?.reload();
  }, [reloadKey, user?.id]);

  // Leaflet sizes a popup when it opens, before the portal has rendered into
  // it, so resize once the content is there.
  useLayoutEffect(() => {
    openPopup?.popup.update();
  }, [openPopup]);

  function closePopup() {
    mapRef.current?.map.closePopup();
  }

  let popupContent = null;
  if (openPopup?.target.kind === 'pin') {
    popupContent = (
      <PinPopup
        pin={openPopup.target.pin}
        onEdit={(pin) => {
          closePopup();
          handlers.current.onEditPin(pin);
        }}
        onDelete={(pin) => handlers.current.onDeletePin(pin)}
      />
    );
  } else if (openPopup?.target.kind === 'new') {
    const { latlng } = openPopup.target;
    popupContent = (
      <button
        type="button"
        className="button button--small"
        onClick={() => {
          closePopup();
          handlers.current.onAddPin(latlng);
        }}
      >
        {user ? 'Add a survey pin here' : 'Sign in to add a pin here'}
      </button>
    );
  }

  return (
    <>
      <main ref={containerRef} className="map" />
      {openPopup && createPortal(popupContent, openPopup.element)}
    </>
  );
}
