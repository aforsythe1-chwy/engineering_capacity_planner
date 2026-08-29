import type { EngineerSprintOutput } from '@ecp/shared';

const round = (value: number) => Math.round(value * 10) / 10;
export function engineerSprintOutputModel(engineer: EngineerSprintOutput, partial: boolean) {
  const output = engineer.donePoints + engineer.inReviewPoints;
  const ratio = !partial && engineer.adjustedCapacity !== null && engineer.adjustedCapacity > 0 ? output / engineer.adjustedCapacity : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);
  const widths = [engineer.donePoints, engineer.inReviewPoints, engineer.inProgressPoints, engineer.toDoPoints].map((points, index, all) => ratio === null ? 0 : Math.min(Math.max(0, 100 - all.slice(0, index).reduce((sum, value) => sum + value / engineer.adjustedCapacity! * 100, 0)), points / engineer.adjustedCapacity! * 100));
  return { output: round(output), done: round(engineer.donePoints), review: round(engineer.inReviewPoints), inProgress: round(engineer.inProgressPoints), toDo: round(engineer.toDoPoints), capacity: engineer.adjustedCapacity === null ? null : round(engineer.adjustedCapacity), percent, doneWidth: widths[0], reviewWidth: widths[1], inProgressWidth: widths[2], toDoWidth: widths[3], doneReviewWidth: Math.min(100, widths[0] + widths[1]), inProgressTotalWidth: Math.min(100, widths[0] + widths[1] + widths[2]), totalScopeWidth: Math.min(100, widths.reduce((sum, width) => sum + width, 0)) };
}
