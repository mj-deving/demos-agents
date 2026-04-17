export interface ColonyPromptPacket<TInput extends object> {
  archetype: string;
  role: string[];
  edge: string[];
  input: TInput;
  instruction: string;
  constraints: string[];
  output: {
    category: string;
    confidenceStyle: string;
    shape: string[];
    successCriteria: string[];
  };
}

export function renderColonyPromptPacket<TInput extends object>(
  packet: ColonyPromptPacket<TInput>,
): string {
  return [
    "Archetype:",
    packet.archetype,
    "",
    "Role:",
    ...packet.role,
    "",
    "Edge:",
    ...packet.edge.map((line) => `- ${line}`),
    "",
    "Input:",
    JSON.stringify(packet.input, null, 2),
    "",
    "Instruction:",
    packet.instruction,
    "",
    "Constraints:",
    ...packet.constraints.map((rule) => `- ${rule}`),
    "",
    "Output:",
    `- Category: ${packet.output.category}`,
    `- Confidence: ${packet.output.confidenceStyle}`,
    ...packet.output.shape.map((line) => `- ${line}`),
    "",
    "Success criteria:",
    ...packet.output.successCriteria.map((line) => `- ${line}`),
    "",
    "Return only the final post text.",
  ].join("\n");
}
