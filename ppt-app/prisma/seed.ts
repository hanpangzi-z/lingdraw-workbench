import { getPrisma } from "../src/server/db/prisma";
import { seedBuiltInResources } from "../src/server/library/templates";

async function main() {
  const systemUser = await getPrisma().user.upsert({
    where: { email: "system@lingdraw.internal" },
    update: { name: "灵绘 PPT 系统", role: "system" },
    create: {
      externalUserId: "system:lingdraw-ppt",
      username: "lingdraw-ppt-system",
      email: "system@lingdraw.internal",
      name: "灵绘 PPT 系统",
      role: "system",
    },
  });
  await seedBuiltInResources(systemUser.id);
  console.log("灵绘 PPT 系统模板与主题已准备");
}

main().then(() => getPrisma().$disconnect()).catch(async (error) => {
  console.error(error);
  await getPrisma().$disconnect();
  process.exit(1);
});
