import type { Position } from '@/models'

/** Where maps open before anyone has a position: the middle of Dhaka. */
export const DHAKA = { lat: 23.8103, lng: 90.4125 }

/**
 * The device's position from the browser (GPS on phones, Wi-Fi on laptops). It remembers the last fix this
 * session, so it can be reused (e.g. to weight votes by proximity) without asking for the location again.
 */
export class LocationService {
  private lastKnown: Position | null = null

  /** The last fix this session, or null before the first one. */
  getLastKnownPosition = (): Position | null => this.lastKnown

  getCurrentPosition = async (): Promise<Position> => {
    if (!navigator.geolocation) throw new Error('Your browser does not support location.')
    try {
      // Phones: real GPS. Laptops often can't deliver "high accuracy", so fall back below.
      this.lastKnown = await this.request({ enableHighAccuracy: true, timeout: 12000, maximumAge: 0 })
      return this.lastKnown
    } catch (first) {
      const e = first as GeolocationPositionError
      if (e.code === e.PERMISSION_DENIED) {
        throw new Error('Location permission denied. Click the icon left of the address bar and allow Location.')
      }
    }
    try {
      // Wi-Fi based location (how laptops locate themselves); accept a fix up to 1 minute old.
      this.lastKnown = await this.request({ enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 })
      return this.lastKnown
    } catch (second) {
      const e = second as GeolocationPositionError
      throw new Error(
        e.code === e.TIMEOUT
          ? 'Getting your location took too long. Try again, or place the pin on the map manually.'
          : 'Your device could not find your location. On a Mac, turn on Wi-Fi and allow your browser in System Settings → Privacy & Security → Location Services. Or place the pin manually.',
      )
    }
  }

  private request(options: PositionOptions): Promise<Position> {
    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        reject,
        options,
      )
    })
  }
}

export const locationService = new LocationService()
