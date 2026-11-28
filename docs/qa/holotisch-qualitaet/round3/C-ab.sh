#!/bin/bash
# usage: C-ab.sh thr reps
R=docs/qa/holotisch-qualitaet/round3
for i in $(seq 1 $2); do
 for m in base defer; do
  if [ $m = base ]; then export ND=1; else unset ND; fi
  node $R/C-load.cjs AEGS_Idris_M 1280 800 $1 ab-$m-$i | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log('$m',r.h1ms,r.stageMs,r.nodes,JSON.stringify(r.lt))"
 done
done
