import { z } from 'zod';

export const CreatePairingCodeSchema = z.object({
  name: z.string().trim().min(1).max(60),
});
export type CreatePairingCode = z.infer<typeof CreatePairingCodeSchema>;

export const PairDeviceSchema = z.object({
  code: z.string().max(40),
});
export type PairDevice = z.infer<typeof PairDeviceSchema>;

export interface PairingCodeResponse {
  /** XXXX-XXXX, shown once. */
  code: string;
  expiresAt: string;
}

export interface PairDeviceResponse {
  deviceToken: string;
  gymId: string;
  gymName: string;
  deviceName: string;
}

export interface KioskMe {
  gymId: string;
  gymName: string;
  deviceName: string;
}

export interface Device {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string | null;
  revoked: boolean;
}
