import type {
  CheckInResult,
  Membership,
  MembershipType,
  Payment,
  PresentMember,
  VisitorRow,
} from '@gym/shared';

export const GYM = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
export const MEMBER = '6f1c2b8e-3d4a-4f5b-9c6d-7e8f9a0b1c2d';

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const monthlyType: MembershipType = {
  id: '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f',
  name: 'Μηνιαία',
  nameEn: 'Monthly',
  kind: 'time',
  durationMonths: 1,
  visitCount: null,
  validityDays: null,
  priceCents: 4000,
  maxFreezeDays: 14,
  includesTrainer: false,
  includesClasses: false,
  archived: false,
};

export function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60',
    memberId: MEMBER,
    typeId: monthlyType.id,
    name: 'Μηνιαία',
    kind: 'time',
    includesTrainer: false,
    includesClasses: false,
    maxFreezeDays: 14,
    priceCents: 4000,
    startsOn: '2027-05-01',
    endsOn: '2027-05-31',
    effectiveEndsOn: '2027-05-31',
    visitsTotal: null,
    visitsUsed: 0,
    voidedAt: null,
    status: 'active',
    remaining: { days: 3, visits: null },
    createdAt: '2027-05-01T09:00:00.000Z',
    ...overrides,
  };
}

export function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6071',
    membershipId: '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60',
    membershipName: 'Μηνιαία',
    memberId: MEMBER,
    memberName: 'Γιώργος Παπαδόπουλος',
    amountCents: 4000,
    method: 'cash',
    paidAt: '2027-05-01T09:00:00.000Z',
    recordedBy: { id: 'r', fullName: 'Μαρία Υποδοχή' },
    voidedAt: null,
    voidedBy: null,
    voidReason: null,
    ...overrides,
  };
}

export function checkInResult(overrides: Partial<CheckInResult> = {}): CheckInResult {
  return {
    checkInId: '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b70',
    valid: true,
    reason: null,
    duplicate: false,
    method: 'kiosk',
    member: { id: MEMBER, firstName: 'Γιώργος', lastName: 'Παπαδόπουλος', photoUrl: null },
    membership: membership(),
    at: '2027-05-02T07:00:00.000Z',
    ...overrides,
  };
}

export function presentMember(overrides: Partial<PresentMember> = {}): PresentMember {
  return {
    checkInId: '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b70',
    memberId: MEMBER,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    photoUrl: null,
    at: '2027-05-02T07:00:00.000Z',
    membershipStatus: 'active',
    ...overrides,
  };
}

export function visitorRow(overrides: Partial<VisitorRow> = {}): VisitorRow {
  return {
    checkInId: '4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b70',
    memberId: MEMBER,
    firstName: 'Γιώργος',
    lastName: 'Παπαδόπουλος',
    at: '2027-05-02T07:00:00.000Z',
    method: 'kiosk',
    valid: true,
    reason: null,
    checkedOutAt: null,
    ...overrides,
  };
}
