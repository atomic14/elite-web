import Foundation

// Clean Elite-A combat model for a 60 fps game loop.
// Rendering cadence never controls damage, firing cadence, or regeneration.

struct NPCTargetStats: Codable, Hashable {
    let name: String
    let maxEnergy: Int
    let perHitDefence: Int
    let isLaserImmune: Bool
    let incomingPlayerLaserMultiplier: Double
    let regenerates: Bool
    let regenerationPerSecond: Double

    init(
        name: String,
        maxEnergy: Int,
        perHitDefence: Int? = nil,
        isLaserImmune: Bool = false,
        incomingPlayerLaserMultiplier: Double = 1.0,
        regenerates: Bool = true,
        regenerationPerSecond: Double = 1.0
    ) {
        self.name = name
        self.maxEnergy = maxEnergy
        self.perHitDefence = perHitDefence ?? (maxEnergy & 7)
        self.isLaserImmune = isLaserImmune
        self.incomingPlayerLaserMultiplier = incomingPlayerLaserMultiplier
        self.regenerates = regenerates
        self.regenerationPerSecond = regenerationPerSecond
    }
}

struct PlayerLaserStats: Codable, Hashable {
    let rawByte: Int

    var isContinuous: Bool { (rawByte & 0x80) != 0 }
    var power: Int { rawByte & 0x7f }
    var baseDamagePerHit: Int { power >> 1 }
}

enum NPCDamageRule: String, Codable, Hashable {
    // Recommended for a recreation: missile count does not alter laser damage.
    case clean

    // Released Elite-A behaviour: shift the whole packed weapon byte.
    case original
}

struct NPCWeaponStats: Codable, Hashable {
    let weaponByte: Int

    var laserPower: Int { (weaponByte >> 3) & 7 }
    var missileCount: Int { weaponByte & 7 }
    var canFireLaser: Bool { laserPower > 0 }

    func damageBeforeArmour(using rule: NPCDamageRule = .clean) -> Int {
        guard canFireLaser else { return 0 }

        switch rule {
        case .clean:
            return laserPower << 2
        case .original:
            return weaponByte >> 1
        }
    }
}

struct PlayerShipDefence: Codable, Hashable {
    let perHitShieldArmour: Int
    var forwardShield: Double = 255
    var aftShield: Double = 255
    var energy: Double = 255
}

struct NPCCombatState: Codable, Hashable {
    let stats: NPCTargetStats
    private(set) var currentEnergy: Double

    init(stats: NPCTargetStats) {
        self.stats = stats
        self.currentEnergy = Double(stats.maxEnergy)
    }

    var isDestroyed: Bool { currentEnergy <= 0 }

    mutating func update(deltaTime: TimeInterval) {
        guard !isDestroyed, stats.regenerates, stats.regenerationPerSecond > 0 else { return }
        currentEnergy = min(
            Double(stats.maxEnergy),
            currentEnergy + stats.regenerationPerSecond * max(0, deltaTime)
        )
    }

    @discardableResult
    mutating func applyPlayerLaserHit(_ laser: PlayerLaserStats) -> Int {
        guard !isDestroyed, !stats.isLaserImmune else { return 0 }

        let scaled = Int(
            floor(Double(laser.baseDamagePerHit) * stats.incomingPlayerLaserMultiplier)
        )
        let damage = max(0, scaled - stats.perHitDefence)
        currentEnergy = max(0, currentEnergy - Double(damage))
        return damage
    }
}

enum EliteACombatMath {
    static func hitsToDestroy(
        target: NPCTargetStats,
        laser: PlayerLaserStats
    ) -> Int? {
        guard !target.isLaserImmune else { return nil }
        let scaled = Int(floor(Double(laser.baseDamagePerHit) * target.incomingPlayerLaserMultiplier))
        let damage = max(0, scaled - target.perHitDefence)
        guard damage > 0 else { return nil }
        return Int(ceil(Double(target.maxEnergy) / Double(damage)))
    }

    static func npcDamageToPlayer(
        weapon: NPCWeaponStats,
        player: PlayerShipDefence,
        rule: NPCDamageRule = .clean
    ) -> Int {
        max(0, weapon.damageBeforeArmour(using: rule) - player.perHitShieldArmour)
    }
}

// Suggested construction helpers.
extension NPCTargetStats {
    static func ordinary(name: String, maxEnergy: Int, regen: Double = 1.0) -> Self {
        .init(name: name, maxEnergy: maxEnergy, regenerationPerSecond: regen)
    }

    static func constrictor(maxEnergy: Int, regen: Double = 1.0) -> Self {
        .init(
            name: "Constrictor",
            maxEnergy: maxEnergy,
            incomingPlayerLaserMultiplier: 0.5,
            regenerationPerSecond: regen
        )
    }

    static func station(name: String, maxEnergy: Int) -> Self {
        .init(
            name: name,
            maxEnergy: maxEnergy,
            isLaserImmune: true,
            regenerates: false,
            regenerationPerSecond: 0
        )
    }

    static func nonRegenerating(name: String, maxEnergy: Int) -> Self {
        .init(name: name, maxEnergy: maxEnergy, regenerates: false, regenerationPerSecond: 0)
    }
}
