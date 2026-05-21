import { ref, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { getIsoWeek, shiftIsoWeek } from "src/lib/iso-week";

/**
 * Owns the (year, isoWeek) state of the Planner page and keeps it in URL-sync
 * via `?week=22&year=2026` query params. Default = current ISO week.
 *
 * Returned values are reactive refs that components bind to. `goPrev/goNext`
 * shift one week at a time including correct year-boundary handling.
 */
export function usePlannerNavigation(): {
  year: Ref<number>;
  isoWeek: Ref<number>;
  goPrev: () => void;
  goNext: () => void;
  goToWeek: (year: number, isoWeek: number) => void;
  goToCurrent: () => void;
} {
  const route = useRoute();
  const router = useRouter();

  const initial = parseQueryOrCurrent(route.query);
  const year = ref<number>(initial.year);
  const isoWeek = ref<number>(initial.isoWeek);

  // Sync state into the URL query on every change so deep-links work and the
  // back button steps through weeks naturally.
  watch([year, isoWeek], async () => {
    await router.replace({
      query: {
        ...route.query,
        year: String(year.value),
        week: String(isoWeek.value),
      },
    });
  });

  // Listen for explicit query-param changes (e.g. another component navigates
  // to ?generate=current). Only react when y/w differ from local state.
  watch(
    () => [route.query.year, route.query.week] as const,
    ([rawYear, rawWeek]) => {
      const parsedYear = parseInt(Array.isArray(rawYear) ? rawYear[0] ?? "" : rawYear ?? "", 10);
      const parsedWeek = parseInt(Array.isArray(rawWeek) ? rawWeek[0] ?? "" : rawWeek ?? "", 10);
      if (
        Number.isFinite(parsedYear) &&
        Number.isFinite(parsedWeek) &&
        (parsedYear !== year.value || parsedWeek !== isoWeek.value)
      ) {
        year.value = parsedYear;
        isoWeek.value = parsedWeek;
      }
    },
  );

  function goPrev(): void {
    const next = shiftIsoWeek(year.value, isoWeek.value, -1);
    year.value = next.year;
    isoWeek.value = next.isoWeek;
  }

  function goNext(): void {
    const next = shiftIsoWeek(year.value, isoWeek.value, 1);
    year.value = next.year;
    isoWeek.value = next.isoWeek;
  }

  function goToWeek(y: number, w: number): void {
    year.value = y;
    isoWeek.value = w;
  }

  function goToCurrent(): void {
    const now = getIsoWeek(new Date());
    year.value = now.year;
    isoWeek.value = now.isoWeek;
  }

  return {
    year,
    isoWeek,
    goPrev,
    goNext,
    goToWeek,
    goToCurrent,
  };
}

function parseQueryOrCurrent(query: ReturnType<typeof useRoute>["query"]): {
  year: number;
  isoWeek: number;
} {
  const rawYear = query.year;
  const rawWeek = query.week;
  const parsedYear = parseInt(Array.isArray(rawYear) ? rawYear[0] ?? "" : rawYear ?? "", 10);
  const parsedWeek = parseInt(Array.isArray(rawWeek) ? rawWeek[0] ?? "" : rawWeek ?? "", 10);
  if (Number.isFinite(parsedYear) && Number.isFinite(parsedWeek)) {
    return { year: parsedYear, isoWeek: parsedWeek };
  }
  return getIsoWeek(new Date());
}
