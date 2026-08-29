import type { EngineerSprintOutput } from '@ecp/shared';

const round = (value: number) => Math.round(value * 10) / 10;
export function engineerSprintOutputModel(engineer: EngineerSprintOutput, partial: boolean) {
  const output = engineer.donePoints + engineer.inReviewPoints;
  const ratio = !partial && engineer.adjustedCapacity !== null && engineer.adjustedCapacity > 0 ? output / engineer.adjustedCapacity : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  return { output: round(output), done: round(engineer.donePoints), review: round(engineer.inReviewPoints), capacity: engineer.adjustedCapacity === null ? null : round(engineer.adjustedCapacity), percent, doneWidth: ratio === null ? 0 : Math.min(100, engineer.donePoints / engineer.adjustedCapacity! * 100), reviewWidth: ratio === null ? 0 : Math.min(100 - Math.min(100, engineer.donePoints / engineer.adjustedCapacity! * 100), engineer.inReviewPoints / engineer.adjustedCapacity! * 100) };
}
