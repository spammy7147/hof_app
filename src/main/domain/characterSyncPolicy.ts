export function shouldStartAutomaticCharacterSync(
  required: boolean,
  evaluatedForSession: boolean,
): boolean {
  return required && !evaluatedForSession;
}
