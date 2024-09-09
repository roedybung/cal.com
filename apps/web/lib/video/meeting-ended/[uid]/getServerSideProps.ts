import type { GetServerSidePropsContext } from "next";

import { BookingRepository } from "@calcom/lib/server/repository/booking";
import { type inferSSRProps } from "@calcom/types/inferSSRProps";

export type PageProps = inferSSRProps<typeof getServerSideProps>;
export async function getServerSideProps(context: GetServerSidePropsContext) {
  const booking = await BookingRepository.findBookingByUidWithOptionalSelect({
    bookingUid: context.query.uid as string,
    select: {
      uid: true,
      user: {
        select: {
          credentials: true,
        },
      },
      references: {
        select: {
          uid: true,
          type: true,
          meetingUrl: true,
        },
      },
    },
  });

  if (!booking) {
    const redirect = {
      redirect: {
        destination: "/video/no-meeting-found",
        permanent: false,
      },
    } as const;

    return redirect;
  }

  const bookingObj = Object.assign({}, booking, {
    startTime: booking.startTime.toString(),
    endTime: booking.endTime.toString(),
  });

  return {
    props: {
      booking: bookingObj,
    },
  };
}
