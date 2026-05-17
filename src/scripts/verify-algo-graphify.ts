import { handleGraphQuery } from "../tools/graphQuery.js";

const SMC =
  "/Users/macbookair/Documents/Visual Studio Code/Python/AlgoTrading/crypto/strategies/active/smc";
const ALGO = "/Users/macbookair/Documents/Visual Studio Code/Python/AlgoTrading";

const cases: [string, string, string, string][] = [
  ["SMC symbol order_manager", SMC, "order_manager", "search"],
  ["SMC graphify Community", SMC, "Community", "graphify_search"],
  ["Algo graphify OrderManager", ALGO, "OrderManager", "graphify_search"],
  ["Algo search Community", ALGO, "Community", "search"],
];

for (const [label, root, q, type] of cases) {
  const r = await handleGraphQuery({
    projectRoot: root,
    query: q,
    queryType: type as "search",
  });
  console.log(
    `${label}: source=${r.source} hits=${r.nodesTraversed} graphify=${r.graphifyReport ? "yes" : "no"}`
  );
}
