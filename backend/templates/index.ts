// Ready-made FMS definitions. build(dir) returns a draft for the builder, with doers matched to users by name.
import repeatSpare = require("./repeatSpare");

const ALL = [repeatSpare];

const list = () => ALL.map((t) => ({ id: t.id, name: t.name, description: t.summary, steps: t.stepCount }));

function build(id, dir) {
  const t = ALL.find((x) => x.id === id);
  return t ? { ...t.build(dir), template: t.id } : null;
}

export = { list, build };
