/** The owner's dashboard (spec §6.9). Amounts are euro cents; months are YYYY-MM in gym time. */

export interface DashboardIncomeMonth {
  month: string;
  totalCents: number;
  byMethod: { cash: number; card: number };
  /** By the membership type's name as it was sold, biggest first. */
  byType: { name: string; cents: number }[];
}

export interface DashboardMemberMonth {
  month: string;
  active: number;
  new: number;
  notRenewed: number;
  /** The month is not settled yet: a member may still renew within 14 days of the month's end. */
  provisional: boolean;
}

export interface Dashboard {
  /** The last 12 months, oldest first, the current month last. */
  income: DashboardIncomeMonth[];
  members: DashboardMemberMonth[];
  /** 7 weekdays (Monday first) x 24 hours: valid check-ins over the last 8 weeks. */
  busyHours: number[][];
  today: {
    /** Members who got in today (valid check-ins, each counted once). */
    visitors: number;
    /** Inside right now. */
    present: number;
    /** Members whose running membership ends within 7 days or has 2 or fewer visits left. */
    expiringSoon: number;
  };
}
