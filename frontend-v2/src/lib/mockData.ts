export type LoadStatus = "OPEN" | "BROADCAST" | "BOOKED" | "IN_TRANSIT" | "DELIVERED";
export type Equipment = "DRY_VAN" | "REEFER" | "FLATBED";

export interface Load {
  id: string;
  shipper: string;
  origin: string;
  destination: string;
  miles: number;
  weightLbs: number;
  equipment: Equipment;
  ratePerMile: number;
  totalRate: number;
  pickupAt: string;
  status: LoadStatus;
  driver?: string;
  expiresAt?: number; // ms epoch for offers
}

export interface Driver {
  id: string;
  name: string;
  mcNumber: string;
  equipment: Equipment;
  maxCapacityLbs: number;
  currentLoadLbs: number;
  location: string;
  rating: number;
  status: "AVAILABLE" | "ON_LOAD" | "OFFLINE";
}

const now = Date.now();
const min = (m: number) => now + m * 60_000;

export const driverOffers: Load[] = [
  {
    id: "L-10421",
    shipper: "Demo Freight Co",
    origin: "Chicago, IL",
    destination: "Columbus, OH",
    miles: 355,
    weightLbs: 28400,
    equipment: "DRY_VAN",
    ratePerMile: 2.85,
    totalRate: 1012,
    pickupAt: "Today · 4:30 PM",
    status: "BROADCAST",
    expiresAt: min(12),
  },
  {
    id: "L-10422",
    shipper: "Midwest Cold Chain",
    origin: "Milwaukee, WI",
    destination: "Indianapolis, IN",
    miles: 297,
    weightLbs: 31200,
    equipment: "REEFER",
    ratePerMile: 3.10,
    totalRate: 920,
    pickupAt: "Tomorrow · 7:00 AM",
    status: "BROADCAST",
    expiresAt: min(7),
  },
  {
    id: "L-10423",
    shipper: "Northbound Logistics",
    origin: "Detroit, MI",
    destination: "Pittsburgh, PA",
    miles: 285,
    weightLbs: 22000,
    equipment: "DRY_VAN",
    ratePerMile: 2.65,
    totalRate: 755,
    pickupAt: "Today · 9:00 PM",
    status: "BROADCAST",
    expiresAt: min(3),
  },
];

export const shipperLoads: Load[] = [
  {
    id: "L-10418",
    shipper: "Demo Freight Co",
    origin: "Chicago, IL",
    destination: "St. Louis, MO",
    miles: 297,
    weightLbs: 24000,
    equipment: "DRY_VAN",
    ratePerMile: 2.50,
    totalRate: 742,
    pickupAt: "Today · 2:00 PM",
    status: "IN_TRANSIT",
    driver: "Marcus T.",
  },
  {
    id: "L-10419",
    shipper: "Demo Freight Co",
    origin: "Chicago, IL",
    destination: "Nashville, TN",
    miles: 472,
    weightLbs: 30500,
    equipment: "DRY_VAN",
    ratePerMile: 2.70,
    totalRate: 1274,
    pickupAt: "Tomorrow · 6:00 AM",
    status: "BOOKED",
    driver: "Elena R.",
  },
  {
    id: "L-10421",
    shipper: "Demo Freight Co",
    origin: "Chicago, IL",
    destination: "Columbus, OH",
    miles: 355,
    weightLbs: 28400,
    equipment: "DRY_VAN",
    ratePerMile: 2.85,
    totalRate: 1012,
    pickupAt: "Today · 4:30 PM",
    status: "BROADCAST",
  },
];

export const receiverShipments: Load[] = [
  {
    id: "L-10410",
    shipper: "Pacific Imports",
    origin: "Long Beach, CA",
    destination: "Phoenix, AZ",
    miles: 372,
    weightLbs: 41000,
    equipment: "DRY_VAN",
    ratePerMile: 2.40,
    totalRate: 892,
    pickupAt: "Arriving today · 6:15 PM",
    status: "IN_TRANSIT",
    driver: "Marcus T.",
  },
  {
    id: "L-10402",
    shipper: "Pacific Imports",
    origin: "Oakland, CA",
    destination: "Phoenix, AZ",
    miles: 745,
    weightLbs: 38500,
    equipment: "REEFER",
    ratePerMile: 2.90,
    totalRate: 2160,
    pickupAt: "Delivered · Yesterday 2:10 PM",
    status: "DELIVERED",
    driver: "Elena R.",
  },
];

export const adminDrivers: Driver[] = [
  { id: "D-001", name: "Marcus Thompson", mcNumber: "MC-882134", equipment: "DRY_VAN", maxCapacityLbs: 45000, currentLoadLbs: 24000, location: "Joliet, IL", rating: 4.9, status: "ON_LOAD" },
  { id: "D-002", name: "Elena Ramirez", mcNumber: "MC-771023", equipment: "REEFER", maxCapacityLbs: 44000, currentLoadLbs: 0, location: "Indianapolis, IN", rating: 4.8, status: "AVAILABLE" },
  { id: "D-003", name: "Jamal Carter", mcNumber: "MC-991745", equipment: "FLATBED", maxCapacityLbs: 48000, currentLoadLbs: 0, location: "Cleveland, OH", rating: 4.7, status: "AVAILABLE" },
  { id: "D-004", name: "Priya Patel", mcNumber: "MC-660912", equipment: "DRY_VAN", maxCapacityLbs: 45000, currentLoadLbs: 0, location: "Detroit, MI", rating: 4.95, status: "OFFLINE" },
];

export const adminMetrics = {
  activeLoads: 142,
  activeDrivers: 318,
  matchRate: 94,
  avgTimeToMatch: 47, // seconds
  weeklyGmv: 1284500,
};