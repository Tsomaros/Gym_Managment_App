import type { Attendee, ClassSessionView, ClassTypeView } from '@gym/shared';

export const SPINNING: ClassTypeView = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Σπινινγκ',
  nameEn: 'Spinning',
  description: null,
  defaultCapacity: 12,
  defaultDurationMinutes: 45,
  archived: false,
};
export const PILATES: ClassTypeView = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Πιλάτες',
  nameEn: null,
  description: 'Mat',
  defaultCapacity: 10,
  defaultDurationMinutes: 50,
  archived: false,
};

export const TRAINER = {
  userId: '33333333-3333-4333-8333-333333333333',
  firstName: 'Νίκος',
  lastName: 'Γυμναστής',
  roles: ['trainer' as const],
};

export function classSession(over: Partial<ClassSessionView> = {}): ClassSessionView {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    date: '2027-05-12',
    startsAt: '18:00',
    endsAt: '18:45',
    type: { id: SPINNING.id, name: SPINNING.name, nameEn: SPINNING.nameEn },
    trainer: { id: TRAINER.userId, firstName: TRAINER.firstName },
    room: 'Α',
    capacity: 12,
    booked: 3,
    cancelled: false,
    seriesId: null,
    ...over,
  };
}

export function attendee(over: Partial<Attendee> & { id?: string } = {}): Attendee {
  const { id = '55555555-5555-4555-8555-555555555555', ...rest } = over;
  return {
    bookingId: id,
    member: { id: `m-${id}`, firstName: 'Μαρία', lastName: 'Νικολάου', photoUrl: null },
    status: 'booked',
    ...rest,
  };
}
