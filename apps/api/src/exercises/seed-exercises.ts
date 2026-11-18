import type { Measure, MuscleGroup } from '@gym/shared';
import { and, eq, inArray, notExists, sql } from 'drizzle-orm';
import { systemDb } from '../db/client';
import { exercises, gyms } from '../db/schema';
import type { Tx } from '../db/tenant';

interface DefaultExercise {
  nameEl: string;
  nameEn: string;
  muscleGroup: MuscleGroup;
  measure: Measure;
}

const w = 'weight_reps' as const;
const r = 'reps' as const;
const d = 'duration' as const;

/** The library every gym starts with (spec §10 leaves the list to the builder). Greek names are unique ignoring case. */
export const DEFAULT_EXERCISES: readonly DefaultExercise[] = [
  { nameEl: 'Πιέσεις στήθους', nameEn: 'Bench press', muscleGroup: 'chest', measure: w },
  {
    nameEl: 'Πιέσεις σε κεκλιμένο πάγκο',
    nameEn: 'Incline bench press',
    muscleGroup: 'chest',
    measure: w,
  },
  {
    nameEl: 'Πιέσεις στήθους με αλτήρες',
    nameEn: 'Dumbbell bench press',
    muscleGroup: 'chest',
    measure: w,
  },
  { nameEl: 'Πεταλούδα', nameEn: 'Chest fly', muscleGroup: 'chest', measure: w },
  { nameEl: 'Κάμψεις στήριξης', nameEn: 'Push-ups', muscleGroup: 'chest', measure: r },
  { nameEl: 'Έλξεις', nameEn: 'Pull-ups', muscleGroup: 'back', measure: r },
  { nameEl: 'Κάτω έλξη λατ', nameEn: 'Lat pulldown', muscleGroup: 'back', measure: w },
  { nameEl: 'Κωπηλατική με μπάρα', nameEn: 'Barbell row', muscleGroup: 'back', measure: w },
  { nameEl: 'Κωπηλατική με αλτήρα', nameEn: 'Dumbbell row', muscleGroup: 'back', measure: w },
  { nameEl: 'Καθιστή κωπηλατική', nameEn: 'Seated cable row', muscleGroup: 'back', measure: w },
  { nameEl: 'Άρσεις θανάτου', nameEn: 'Deadlift', muscleGroup: 'back', measure: w },
  { nameEl: 'Υπερέκταση μέσης', nameEn: 'Back extension', muscleGroup: 'back', measure: r },
  { nameEl: 'Πιέσεις ώμων', nameEn: 'Overhead press', muscleGroup: 'shoulders', measure: w },
  {
    nameEl: 'Πιέσεις ώμων με αλτήρες',
    nameEn: 'Dumbbell shoulder press',
    muscleGroup: 'shoulders',
    measure: w,
  },
  { nameEl: 'Πλάγιες ανυψώσεις', nameEn: 'Lateral raise', muscleGroup: 'shoulders', measure: w },
  { nameEl: 'Μπροστινές ανυψώσεις', nameEn: 'Front raise', muscleGroup: 'shoulders', measure: w },
  { nameEl: 'Οπίσθιες ανυψώσεις', nameEn: 'Rear delt fly', muscleGroup: 'shoulders', measure: w },
  { nameEl: 'Τραπέζιοι με μπάρα', nameEn: 'Barbell shrug', muscleGroup: 'shoulders', measure: w },
  { nameEl: 'Κάμψεις δικεφάλων', nameEn: 'Biceps curl', muscleGroup: 'biceps', measure: w },
  { nameEl: 'Κάμψεις με μπάρα', nameEn: 'Barbell curl', muscleGroup: 'biceps', measure: w },
  { nameEl: 'Κάμψεις σφυρί', nameEn: 'Hammer curl', muscleGroup: 'biceps', measure: w },
  { nameEl: 'Κάμψεις σε πάγκο scott', nameEn: 'Preacher curl', muscleGroup: 'biceps', measure: w },
  {
    nameEl: 'Εκτάσεις τρικεφάλων με τροχαλία',
    nameEn: 'Triceps pushdown',
    muscleGroup: 'triceps',
    measure: w,
  },
  { nameEl: 'Γαλλικές πιέσεις', nameEn: 'Skull crusher', muscleGroup: 'triceps', measure: w },
  { nameEl: 'Βουτιές σε παράλληλες', nameEn: 'Dips', muscleGroup: 'triceps', measure: r },
  {
    nameEl: 'Εκτάσεις τρικεφάλων πάνω από το κεφάλι',
    nameEn: 'Overhead triceps extension',
    muscleGroup: 'triceps',
    measure: w,
  },
  { nameEl: 'Βαθύ κάθισμα', nameEn: 'Squat', muscleGroup: 'legs', measure: w },
  { nameEl: 'Μπροστινό κάθισμα', nameEn: 'Front squat', muscleGroup: 'legs', measure: w },
  { nameEl: 'Πρέσα ποδιών', nameEn: 'Leg press', muscleGroup: 'legs', measure: w },
  { nameEl: 'Εκτάσεις ποδιών', nameEn: 'Leg extension', muscleGroup: 'legs', measure: w },
  { nameEl: 'Κάμψεις ποδιών', nameEn: 'Leg curl', muscleGroup: 'legs', measure: w },
  { nameEl: 'Προβολές', nameEn: 'Lunges', muscleGroup: 'legs', measure: w },
  {
    nameEl: 'Βουλγαρικό κάθισμα',
    nameEn: 'Bulgarian split squat',
    muscleGroup: 'legs',
    measure: w,
  },
  {
    nameEl: 'Ρουμάνικη άρση θανάτου',
    nameEn: 'Romanian deadlift',
    muscleGroup: 'legs',
    measure: w,
  },
  {
    nameEl: 'Ανυψώσεις γάμπας όρθιος',
    nameEn: 'Standing calf raise',
    muscleGroup: 'legs',
    measure: w,
  },
  {
    nameEl: 'Ανυψώσεις γάμπας καθιστός',
    nameEn: 'Seated calf raise',
    muscleGroup: 'legs',
    measure: w,
  },
  { nameEl: 'Ανύψωση λεκάνης', nameEn: 'Hip thrust', muscleGroup: 'glutes', measure: w },
  { nameEl: 'Γέφυρα γλουτών', nameEn: 'Glute bridge', muscleGroup: 'glutes', measure: r },
  {
    nameEl: 'Κλωτσιές γλουτών με τροχαλία',
    nameEn: 'Cable kickback',
    muscleGroup: 'glutes',
    measure: w,
  },
  {
    nameEl: 'Απαγωγή ποδιών στο μηχάνημα',
    nameEn: 'Hip abduction machine',
    muscleGroup: 'glutes',
    measure: w,
  },
  { nameEl: 'Σανίδα', nameEn: 'Plank', muscleGroup: 'core', measure: d },
  { nameEl: 'Πλάγια σανίδα', nameEn: 'Side plank', muscleGroup: 'core', measure: d },
  { nameEl: 'Κοιλιακοί', nameEn: 'Crunches', muscleGroup: 'core', measure: r },
  { nameEl: 'Ανύψωση ποδιών', nameEn: 'Leg raise', muscleGroup: 'core', measure: r },
  { nameEl: 'Ρωσικές στροφές', nameEn: 'Russian twist', muscleGroup: 'core', measure: r },
  { nameEl: 'Ορειβάτης', nameEn: 'Mountain climbers', muscleGroup: 'core', measure: d },
  { nameEl: 'Ροδάκι κοιλιακών', nameEn: 'Ab wheel rollout', muscleGroup: 'core', measure: r },
  { nameEl: 'Διάδρομος', nameEn: 'Treadmill', muscleGroup: 'cardio', measure: d },
  { nameEl: 'Ποδήλατο', nameEn: 'Stationary bike', muscleGroup: 'cardio', measure: d },
  { nameEl: 'Κωπηλατικό μηχάνημα', nameEn: 'Rowing machine', muscleGroup: 'cardio', measure: d },
  { nameEl: 'Ελλειπτικό', nameEn: 'Elliptical', muscleGroup: 'cardio', measure: d },
  { nameEl: 'Σχοινάκι', nameEn: 'Jump rope', muscleGroup: 'cardio', measure: d },
  { nameEl: 'Μπέρπι', nameEn: 'Burpees', muscleGroup: 'full_body', measure: r },
  {
    nameEl: 'Αιώρηση kettlebell',
    nameEn: 'Kettlebell swing',
    muscleGroup: 'full_body',
    measure: w,
  },
  { nameEl: 'Καθαρή άρση', nameEn: 'Power clean', muscleGroup: 'full_body', measure: w },
  { nameEl: 'Άλμα σε κουτί', nameEn: 'Box jump', muscleGroup: 'full_body', measure: r },
  { nameEl: 'Περπάτημα του αγρότη', nameEn: "Farmer's walk", muscleGroup: 'full_body', measure: d },
];

/**
 * Adds the default library to a gym. Idempotent: an exercise whose Greek name (ignoring case)
 * the gym already has is skipped, so a re-run never overwrites the gym's own edits.
 */
export async function seedExercises(tx: Tx | typeof systemDb, gymId: string): Promise<void> {
  await tx
    .insert(exercises)
    .values(DEFAULT_EXERCISES.map((e) => ({ gymId, ...e })))
    .onConflictDoNothing();
}

/**
 * At startup: gives every gym that has no exercises at all the default library (existing gyms
 * when this feature first ships). A gym that archived everything still has rows, so it is left alone.
 * `only` limits it to those gyms (tests share one database, so they must not touch other gyms).
 */
export async function seedGymsWithoutExercises(only?: readonly string[]): Promise<void> {
  const empty = await systemDb
    .select({ id: gyms.id })
    .from(gyms)
    .where(
      and(
        only ? inArray(gyms.id, [...only]) : undefined,
        notExists(
          systemDb
            .select({ one: sql`1` })
            .from(exercises)
            .where(eq(exercises.gymId, gyms.id)),
        ),
      ),
    );
  for (const g of empty) await seedExercises(systemDb, g.id);
}
