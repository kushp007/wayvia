export type ActivityCategory = "Outdoors" | "Food & drink" | "Culture" | "Sightseeing" | "Stay" | "Transport"
export type TripTab = "Overview" | "Discover" | "Voting" | "Itinerary" | "Budget" | "AI planner"

export interface TripMember { id: string; name: string; initials: string; color: string; role: "Owner" | "Member" }
export interface Activity { id: string; name: string; category: ActivityCategory; location: string; description: string; cost: number; duration: string; votes: string[]; day?: number; time?: string; image?: string }
export interface Trip { id: string; name: string; destination: string; startDate: string; endDate: string; budget: number; interests: string[]; image: string; members: TripMember[]; activities: Activity[] }
export interface PlaceSearchResult { id: string; name: string; category: ActivityCategory; location: string; rating?: number; cost: number; description: string; image?: string }
export interface WeatherData { temperature: number; condition: string; feelsLike: number; humidity: number; wind: number; updatedAt: string }
export interface AIRecommendation { id: string; title: string; category: ActivityCategory; description: string; duration: string; cost: number }

export const initialTrip: Trip = {
  id: "sd-weekend", name: "San Diego Weekend Escape", destination: "San Diego, California", startDate: "2027-06-12", endDate: "2027-06-14", budget: 2400, interests: ["Coastlines", "Local food", "Outdoors"], image: "/san-diego-coast.png",
  members: [
    { id: "maya", name: "Maya Chen", initials: "MC", color: "#d6a38a", role: "Owner" },
    { id: "leo", name: "Leo Martinez", initials: "LM", color: "#8da8a3", role: "Member" },
    { id: "sarah", name: "Sarah Kim", initials: "SK", color: "#b49aca", role: "Member" },
    { id: "you", name: "You", initials: "JD", color: "#e8bd76", role: "Member" },
  ],
  activities: [
    { id: "la-jolla", name: "La Jolla Cove", category: "Outdoors", location: "La Jolla, San Diego", description: "Swim, snorkel, or watch sea lions along this sunlit stretch of coastline.", cost: 24, duration: "2 hours", votes: ["maya", "leo", "you"], day: 1, time: "9:30 AM", image: "https://images.unsplash.com/photo-1519046904884-53103b34b206?auto=format&fit=crop&w=700&q=80" },
    { id: "sunset-cliffs", name: "Sunset Cliffs at golden hour", category: "Sightseeing", location: "Point Loma", description: "Follow the coastal trail as the sun dips into the Pacific.", cost: 0, duration: "1.5 hours", votes: ["maya", "sarah", "you"], day: 1, time: "6:30 PM", image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=700&q=80" },
    { id: "balboa", name: "Balboa Park & gardens", category: "Culture", location: "Balboa Park", description: "Explore Spanish Colonial architecture, quiet gardens, and local museums.", cost: 18, duration: "3 hours", votes: ["leo", "sarah"], day: 2, time: "10:00 AM", image: "https://images.unsplash.com/photo-1533105079780-92b9be482077?auto=format&fit=crop&w=700&q=80" },
    { id: "tacos", name: "Tacos at The Taco Stand", category: "Food & drink", location: "La Jolla Village", description: "A casual local favorite for handmade tortillas and Baja-style fish tacos.", cost: 32, duration: "1 hour", votes: ["maya", "leo", "sarah", "you"], day: 1, time: "12:30 PM" },
    { id: "coronado", name: "Coronado Beach bike ride", category: "Outdoors", location: "Coronado Island", description: "Cruise the beach path with wide-open views back toward the city.", cost: 46, duration: "2 hours", votes: ["maya"], day: 3, time: "9:00 AM" },
    { id: "old-town", name: "Old Town evening stroll", category: "Culture", location: "Old Town", description: "A lively walk through San Diego's historic heart and colorful courtyards.", cost: 0, duration: "1 hour", votes: ["sarah", "you"] },
  ],
}

export const places: PlaceSearchResult[] = [
  { id: "p1", name: "Torrey Pines State Reserve", category: "Outdoors", location: "La Jolla · 15 min away", rating: 4.8, cost: 15, description: "Clifftop trails with sweeping views of the Pacific Ocean.", image: "https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=700&q=80" },
  { id: "p2", name: "Liberty Public Market", category: "Food & drink", location: "Point Loma · 18 min away", rating: 4.7, cost: 28, description: "A lively market hall with independent makers and local flavors.", image: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=700&q=80" },
  { id: "p3", name: "The Museum of Contemporary Art", category: "Culture", location: "La Jolla · 5 min away", rating: 4.5, cost: 20, description: "A considered collection in a striking oceanfront setting.", image: "https://images.unsplash.com/photo-1561214115-f2f134cc4912?auto=format&fit=crop&w=700&q=80" },
  { id: "p4", name: "Seaport Village", category: "Sightseeing", location: "Downtown · 22 min away", rating: 4.4, cost: 12, description: "Harborfront paths, independent shops, and breezy patios.", image: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=700&q=80" },
]

export const weather: WeatherData = { temperature: 21, condition: "Mostly sunny", feelsLike: 22, humidity: 64, wind: 11, updatedAt: "Updated just now · Sample forecast" }
