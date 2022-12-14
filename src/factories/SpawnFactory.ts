import { Engine } from "glaze/ecs/Engine"
import { Entity } from "glaze/ecs/Entity"
import { Position } from "glaze/core/components/Position"

import SpawnOnCameraArrival from "../components/SpawnOnCameraArrival"

import enemyMet1 from "./enemy/met1"
import enemyTurret1 from "./enemy/turret1"
import enemyTurret2 from "./enemy/turret2"
import enemyCatapult from "./enemy/catapult"
import enemySpider1 from "./enemy/spider1"
import blockShootable from "./block/shootable"
import blockBouncy from "./block/bouncy"
import bossBouncy from "./boss/bouncy"

export default class SpawnFactory {
  static create(engine: Engine, kind: string, position: Position): Entity {
    switch (kind) {
      case "enemy-met1":
        return createSpawn(engine, position, enemyMet1)
      case "enemy-turret1":
        return createSpawn(engine, position, enemyTurret1)
      case "enemy-turret2":
        return createSpawn(engine, position, enemyTurret2)
      case "enemy-catapult":
        return createSpawn(engine, position, enemyCatapult)
      case "enemy-spider1":
        return createSpawn(engine, position, enemySpider1)
      case "block-shootable":
        return blockShootable(engine, 0, position)
      case "block-bouncy":
        return blockBouncy(engine, 0, position)
      case "boss-bouncy":
        return createSpawn(engine, position, bossBouncy)
      default:
        throw new Error(`Unknown spawn kind: ${kind}`)
    }
  }
}

function createSpawn(
  engine: Engine,
  position: Position,
  spawnAction: (engine: Engine, spawner: Entity, position: Position) => Entity,
) {
  const spawnEntity = engine.createEntity()

  engine.addComponentsToEntity(spawnEntity, [
    position,
    new SpawnOnCameraArrival({ spawnAction }),
  ])

  return spawnEntity
}
