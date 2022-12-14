import { AABB2 } from "glaze/geom/AABB2"
import { DigitalInput } from "glaze/util/DigitalInput"
import { Entity } from "glaze/ecs/Entity"
import { Extents } from "glaze/core/components/Extents"
import { Graphics } from "glazejs/src/glaze/graphics/components/Graphics"
import { GZE } from "glaze/GZE"
import { Key } from "glaze/util/Keycodes"
import { PhysicsBody } from "glaze/physics/components/PhysicsBody"
import { PhysicsCollision } from "glaze/physics/components/PhysicsCollision"
import { Position } from "glaze/core/components/Position"
import { System } from "glaze/ecs/System"
import { TileMapCollision } from "glaze/physics/collision/broadphase/TileMapCollision"
import { Vector2 } from "glaze/geom/Vector2"
import { Active } from "glazejs/src/glaze/core/components/Active"

import { Player } from "../components/Player"
import GraphicsAnimation from "../components/GraphicsAnimation"
import Climber from "../components/Climber"
import Climbing from "../components/Climbing"
import Health from "../components/Health"
import PlayerFactory from "../factories/PlayerFactory"

export default class PlayerSystem extends System {
  private input: DigitalInput
  private tileMap: TileMapCollision

  constructor(input: DigitalInput, tileMap: TileMapCollision) {
    super([
      Player,
      Position,
      Extents,
      PhysicsCollision,
      PhysicsBody,
      Graphics,
      GraphicsAnimation,
      Health,
      Climber,
      Active,
    ])
    this.input = input
    this.tileMap = tileMap
  }

  updateEntity(
    entity: Entity,
    player: Player,
    position: Position,
    extents: Extents,
    physicsCollision: PhysicsCollision,
    physicsBody: PhysicsBody,
    graphics: Graphics,
    graphicsAnimation: GraphicsAnimation,
    health: Health,
    climber: Climber,
    active: Active,
  ) {
    let left =
      this.input.Pressed(Key.LeftArrow) || this.input.Pressed(Key.Comma)
    let right =
      this.input.Pressed(Key.RightArrow) || this.input.Pressed(Key.ForwardSlash)
    let down =
      this.input.Pressed(Key.DownArrow) || this.input.Pressed(Key.Period)
    let up = this.input.Pressed(Key.UpArrow) || this.input.Pressed(Key.L)

    let jumpStart = this.input.JustPressed(Key.G)
    let jumpHold = this.input.Pressed(Key.G)
    let shootNow = this.input.JustPressed(Key.R)
    let shootHold = this.input.Pressed(Key.R)

    let climbing: Climbing | null = this.engine.getComponentForEntity(
      entity,
      Climbing,
    )

    // Holding opposite directions at once cancels them.
    if (left && right) {
      left = false
      right = false
    }
    if (up && down) {
      up = false
      down = false
    }

    if (health.isReceivingDamage) {
      // Damage cancels all inputs.
      left = false
      right = false
      down = false
      up = false
      jumpStart = false
      jumpHold = false
      shootNow = false
      shootHold = false

      // If damage receiving has started, but we haven't set up
      // the extra immunity frames yet, set those up now.
      if (!health.isImmuneToDamage)
        health.immuneToDamageUntil =
          this.timestamp + player.config.damageImmunityDurationMillis

      // Damage cancels sliding, unless prohibited by a low ceiling.
      if (player.isSliding && !this.isPlayerUnderALowCeiling(position.coords))
        player.stopSliding()

      // Damage cancels climbing.
      if (climbing)
        this.engine.removeComponentsFromEntityByType(entity, [Climbing])

      // Damage pushes the player backward at a constant speed.
      physicsBody.body.velocity.x = 0
      physicsBody.body.addProportionalForce(
        new Vector2(
          position.direction.x * player.config.receivingDamageForce * -1,
          0,
        ),
      )
    }

    // When walking on the ground, disable the effects of friction on movement.
    // We do this because the physics system models the friction as impeding
    // movement, with the character modeled as a sliding box.
    // In the real world, walking movement is aided by friction, with high
    // friction helping the shoes to get traction and move at full speed.
    // So in order to model that here, we use a zero friction when walking.
    // But as soon as the character stops walking, friction is restored.
    // TODO: Add the possibility of slippery ice-like friction.
    if (physicsBody.body.onGround && (left || right))
      physicsBody.body.material.friction = 0
    else physicsBody.body.material.friction = player.config.stopFriction

    // When the player is jumping and stops ascending, the jump is over,
    // and the player is just falling at this point.
    if (player.isJumping && physicsBody.body.velocity.y >= 0)
      player.stopJumping()

    // A jump can be initiated when starting from the ground.
    if (jumpStart && physicsBody.body.onGround) {
      // Holding down and pressing jump will start a slide instead of a jump.
      if (down) {
        // A slide can't be initiated while already sliding -
        // doing so would allow infinite sliding without standing up.
        if (!player.isSliding) {
          player.startSliding(this.timestamp)
          physicsBody.body.addProportionalForce(new Vector2(0, 100))
        }
      } else {
        // A jump can't be initiated when sliding under a low ceiling.
        const slidingUnderALowCeiling =
          player.isSliding && this.isPlayerUnderALowCeiling(position.coords)
        if (!slidingUnderALowCeiling) {
          physicsBody.body.addProportionalForce(new Vector2(0, -100))
          player.startJumping(this.timestamp)
          player.stopSliding() // jumping can cancel a slide
        }
      }
    }
    // A jump while climbing cancels the climb.
    else if (jumpStart && climbing) {
      this.engine.removeComponentsFromEntityByType(entity, [Climbing])
      climbing = null
      // Holding left or right while jumping from a climb gives a kick of force
      // in that direction, helping the player accelerate more quickly
      // than they otherwise could from a standstill velocity.
      if (left || right) {
        physicsBody.body.addProportionalForce(
          new Vector2(
            left ? -player.config.walkForce : player.config.walkForce,
            0,
          ),
        )
      }
    }

    // If already sliding for a while, the slide should stop,
    // unless the player's head is directly under a tile
    if (
      player.startedSlidingAt &&
      player.startedSlidingAt <=
        this.timestamp - player.config.slideDurationMillis &&
      !this.isPlayerUnderALowCeiling(position.coords)
    ) {
      player.stopSliding()
    }

    // Leaving the ground while sliding, if the slide has been going on for
    // some time (such as sliding off a ledge) cancels the slide.
    if (
      player.isSliding &&
      !physicsBody.body.onGround &&
      player.startedSlidingAt &&
      player.startedSlidingAt <= this.timestamp - 100
    ) {
      player.stopSliding()
      physicsBody.body.velocity.x = 0
    }

    // While climbing and shooting, holding left or right can
    // change the player's direction of shooting.
    if (climbing && shootNow && (left || right)) {
      position.direction.x = left ? -1 : 1
    }

    // If shoot button was just pressed, shoot.
    if (shootNow && !player.isSliding) {
      // Start the shoot animation timer.
      player.shootNow(this.timestamp)

      // Create a shot.
      const shootDir = position.direction.x
      PlayerFactory.createShot(
        this.engine,
        new Position(
          position.coords.x + shootDir * player.config.shootOffsetX,
          position.coords.y + player.config.shootOffsetY,
          shootDir,
        ),
      )
    }

    // Not holding the jump button cancels any upward movement.
    // This allows the player to control the total jump height.
    if (!jumpHold && physicsBody.body.velocity.y < 0 && player.isJumping)
      physicsBody.body.velocity.y = 0

    // Holding the left or right arrow key applies a force in that direction,
    // whether walking on the ground or jumping/falling through the air
    // (platformer games often ignore realistic jumping physics that would
    // imply having very little ability to influence one's velocity mid-air,
    // because it feels satisfying to have a high degree of mid-air control)
    //
    // The force amount is low when the current velocity is low, but much
    // higher when the current velocity is already high.
    //
    // In practice, this allows for taking small, inching steps (low force)
    // but also for quickly turning around when already in horizontal motion.
    //
    // We use a proportional force so that the character mass is ignored,
    // allowing the acceleration to be predictable for different characters,
    // making the in-universe justifying assumption that a character's size
    // is roughly proportional to their muscle system's motive force
    if ((left || right) && !climbing) {
      position.direction.x = left ? -1 : 1
      const xForceAmount =
        Math.abs(physicsBody.body.velocity.x) < player.config.maxStepSpeed
          ? player.config.stepForce
          : player.config.walkForce
      physicsBody.body.addProportionalForce(
        new Vector2(left ? xForceAmount * -1 : xForceAmount, 0),
      )
    }
    // If not pressing left or right, sliding impels a force of its own,
    // which is in the current facing direction and of a constant magnitude.
    // Pressing left or right while sliding can change direction of the slide,
    // but that uses the code path above rather than this one
    // (which is why this is an `else if`)
    else if (player.isSliding) {
      const xForceAmountSlide = player.config.slideForce
      physicsBody.body.addProportionalForce(
        new Vector2(
          position.direction.x < 0 ? xForceAmountSlide * -1 : xForceAmountSlide,
          0,
        ),
      )
    } else if (physicsBody.body.velocity.y !== 0) {
      physicsBody.body.addProportionalForce(
        new Vector2(-0.0005 * physicsBody.body.velocity.x, 0),
      )
    }

    // If the player is currently sliding, the bounding box becomes
    // short and wide, as opposed to its default state of tall and narrow.
    if (player.isSliding) {
      extents.halfWidths.x = player.config.width
      extents.halfWidths.y = 15.5
      physicsCollision.proxy.aabb.extents.copy(extents.halfWidths)
      physicsBody.body.maxVelocity.setTo(
        player.config.maxSlideSpeed,
        player.config.maxVerticalSpeed,
      )
    } else {
      extents.halfWidths.x = player.config.width
      extents.halfWidths.y = player.config.height
      extents.offset.y = 0
      physicsCollision.proxy.aabb.extents.copy(extents.halfWidths)
      physicsBody.body.maxVelocity.setTo(
        player.config.maxWalkSpeed,
        player.config.maxVerticalSpeed,
      )
    }

    // Up and down arrows can imply wanting to climb up or down.
    climber.wantsUp = up && !shootHold && !player.isSliding
    climber.wantsDown = down && !shootHold && !player.isSliding

    // Climbing down onto a floor cancels the climb.
    if (climber.wantsDown && this.isPlayerAboveAFloor(position.coords)) {
      this.engine.removeComponentsFromEntityByType(entity, [Climbing])
      climbing = null
    }

    // When immune to damage, the sprite's transparency flashes on and off.
    if (health.isImmuneToDamage) {
      graphics.sprite.alpha = Math.floor((this.timestamp / 150) % 2)
    } else {
      graphics.sprite.alpha = 1
    }

    // Update the shown animation based on current state.
    if (health.isReceivingDamage) {
      graphicsAnimation.play("ouch")
    } else if (climbing) {
      if (shootHold || player.isShootingNow(this.timestamp)) {
        graphicsAnimation.play("climb-shoot")
      } else if (climbing.isNearTheTop) {
        graphicsAnimation.play("climb-top")
      } else if (
        (1024 + climbing.offset.y) % (GZE.tileSize * 4) <
        GZE.tileSize * 2
      ) {
        graphicsAnimation.play("climb")
      } else {
        graphicsAnimation.play("climb-alt")
      }
    } else if (player.isSliding) {
      graphicsAnimation.play("slide")
    } else if (
      physicsBody.body.onGround &&
      Math.abs(physicsBody.body.velocity.x) > player.config.minWalkSpeed
    ) {
      // If already walking, set the animation ID instead of calling `play`,
      // so that changing to walk-shoot won't start at the first frame of the
      // animation, but will rather switch seamlessly to the same frame in
      // the other animation as it was about to use in the current animation.
      //
      // This prevents an issue where tapping shoot quickly while walking
      // would keep the character stuck at the first frame of the animation,
      // making it look like they were skating while shooting, instead of
      // walking while shooting as they are supposed to be.
      const alreadyWalking = graphicsAnimation.animationId.startsWith("walk")
      const newWalk =
        player.isShootingNow(this.timestamp) || shootHold
          ? "walk-shoot"
          : "walk"
      graphicsAnimation.play(newWalk, {
        shouldNotResetTime: alreadyWalking,
      })
    } else if (
      physicsBody.body.onGround &&
      Math.abs(physicsBody.body.velocity.x) > 1 &&
      Math.abs(physicsBody.body.velocity.x) >
        Math.abs(physicsBody.body.previousVelocity.x)
    ) {
      if (player.isShootingNow(this.timestamp) || shootHold) {
        graphicsAnimation.play("shoot")
      } else {
        graphicsAnimation.play("step")
      }
    } else if (!physicsBody.body.onGround) {
      if (player.isShootingNow(this.timestamp) || shootHold) {
        graphicsAnimation.play("jump-shoot")
      } else {
        graphicsAnimation.play("jump")
      }
    } else {
      if (player.isShootingNow(this.timestamp) || shootHold) {
        graphicsAnimation.play("shoot")
      } else {
        graphicsAnimation.play("idle")
      }
    }
  }

  private isPlayerUnderALowCeilingAABB2 = new AABB2()
  private isPlayerUnderALowCeiling(position: Vector2) {
    const checkBounds = this.isPlayerUnderALowCeilingAABB2
    checkBounds.l = position.x - GZE.tileSize * 0.45
    checkBounds.r = position.x + GZE.tileSize * 0.45
    checkBounds.t = position.y - GZE.tileSize * 1.45
    checkBounds.b = position.y - GZE.tileSize * 0.55

    let isUnderALowCeiling = false
    this.tileMap.iterateCells(checkBounds, () => {
      isUnderALowCeiling = true
    })
    return isUnderALowCeiling
  }

  private isPlayerAboveAFloorAABB2 = new AABB2()
  private isPlayerAboveAFloor(position: Vector2) {
    const checkBounds = this.isPlayerAboveAFloorAABB2
    checkBounds.l = position.x - GZE.tileSize * 0.45
    checkBounds.r = position.x + GZE.tileSize * 0.45
    checkBounds.t = position.y + GZE.tileSize * 0.55
    checkBounds.b = position.y + GZE.tileSize * 1.45

    let isAboveAFloor = false
    this.tileMap.iterateCells(checkBounds, () => {
      isAboveAFloor = true
    })
    return isAboveAFloor
  }
}
