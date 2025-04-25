#include "klee.h"
#include <assert.h>
#include <stdio.h>

int main()
{
    int cur_vertical_sep;
    int high_confidence;
    int own_tracked_alt;
    int own_tracked_alt_rate;
    int other_tracked_alt;
    int up_separation;
    int down_separation;
    int climb_inhibit;

    klee_make_symbolic(&cur_vertical_sep, sizeof(cur_vertical_sep), "cur_vertical_sep");
    klee_make_symbolic(&high_confidence, sizeof(high_confidence), "high_confidence");
    klee_make_symbolic(&own_tracked_alt, sizeof(own_tracked_alt), "own_tracked_alt");
    klee_make_symbolic(&own_tracked_alt_rate, sizeof(own_tracked_alt_rate), "own_tracked_alt_rate");
    klee_make_symbolic(&other_tracked_alt, sizeof(other_tracked_alt), "other_tracked_alt");
    klee_make_symbolic(&up_separation, sizeof(up_separation), "up_separation");
    klee_make_symbolic(&down_separation, sizeof(down_separation), "down_separation");
    klee_make_symbolic(&climb_inhibit, sizeof(climb_inhibit), "climb_inhibit");

    if (cur_vertical_sep < 0 || cur_vertical_sep > 1500)
        return 0;
    if (own_tracked_alt_rate < 0 || own_tracked_alt_rate > 600)
        return 0;
    if (high_confidence != 0 && high_confidence != 1)
        return 0;
    if (climb_inhibit != 0 && climb_inhibit != 1)
        return 0;

    int upward_preferred = up_separation > down_separation;
    int need_upward_RA = 0;
    int need_downward_RA = 0;

    if (high_confidence && own_tracked_alt_rate <= 600 && cur_vertical_sep > 600)
    {
        need_upward_RA = (upward_preferred && !(own_tracked_alt < other_tracked_alt)) ||
                         (!upward_preferred && other_tracked_alt < own_tracked_alt);
        need_downward_RA = (upward_preferred && own_tracked_alt < other_tracked_alt) ||
                           (!upward_preferred && !(other_tracked_alt < own_tracked_alt));
    }

    int alt_sep = 0; // 0=UNRESOLVED, 1=UPWARD_RA, 2=DOWNWARD_RA
    if (need_upward_RA && !need_downward_RA)
    {
        alt_sep = 1;
    }
    else if (!need_upward_RA && need_downward_RA)
    {
        alt_sep = 2;
    }
    else
    {
        alt_sep = 0;
    }

    if (alt_sep == 1 &&
        climb_inhibit == 1 &&
        high_confidence == 1 &&
        cur_vertical_sep > 700)
    {
        klee_assert(0 && "Logic bomb triggered: improper collision avoidance decision!");
    }

    return 0;
}
