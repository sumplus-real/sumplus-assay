// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AssayAnchor
/// @notice One line per completed assay: the hash of the comparison, the
/// category it belongs to, and the block it landed in.
///
/// An advantage report is a claim about your own product, written by you and
/// read by someone who was not in the room. The only property the report needs
/// from a chain is that it cannot be improved after the fact, so that is all
/// this contract does.
///
/// Anchors are chained as well as stored. Storing them alone would let a run be
/// dropped from the middle of the record without trace; the running head means
/// removing or reordering one changes every head after it.
contract AssayAnchor {
    struct Anchor {
        bytes32 assayHash;
        bytes32 prevHead;
        uint64 at;
        address by;
        string category;
    }

    Anchor[] private _anchors;

    /// @notice keccak256 over (previous head, assay hash, category), in order.
    bytes32 public head;

    event Anchored(uint256 indexed index, bytes32 indexed assayHash, string category, bytes32 head);

    function anchor(bytes32 assayHash, string calldata category) external returns (uint256 index) {
        require(assayHash != bytes32(0), "empty assay hash");
        require(bytes(category).length != 0, "empty category");

        index = _anchors.length;
        bytes32 prev = head;
        _anchors.push(Anchor({
            assayHash: assayHash,
            prevHead: prev,
            at: uint64(block.timestamp),
            by: msg.sender,
            category: category
        }));
        head = keccak256(abi.encodePacked(prev, assayHash, category));
        emit Anchored(index, assayHash, category, head);
    }

    function count() external view returns (uint256) {
        return _anchors.length;
    }

    function get(uint256 index) external view returns (Anchor memory) {
        require(index < _anchors.length, "no such anchor");
        return _anchors[index];
    }

    /// @notice Recompute the head from the stored anchors. A verifier should
    /// call this and compare with `head`, rather than trusting `head` alone.
    function recomputeHead() external view returns (bytes32 recomputed) {
        for (uint256 i = 0; i < _anchors.length; i++) {
            recomputed = keccak256(abi.encodePacked(recomputed, _anchors[i].assayHash, _anchors[i].category));
        }
    }
}
